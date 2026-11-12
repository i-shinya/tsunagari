import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

class Again extends Error {}

const MAX_UNPACKED = 128 * 1024 * 1024;

function staleTmps(dest: string): string[] {
  const dir = dirname(dest);
  const head = `${basename(dest)}.`;
  return readdirSync(dir)
    .filter((n) => n.startsWith(head) && n.endsWith(".tmp"))
    .map((n) => join(dir, n))
    .filter((p) => {
      try {
        return Date.now() - statSync(p).mtimeMs >= 60_000;
      } catch {
        return false;
      }
    });
}

function takeOver(dest: string, tmp: string) {
  if (existsSync(tmp)) return;
  for (const p of staleTmps(dest)) {
    if (p.endsWith(".out.tmp")) continue;
    try {
      renameSync(p, tmp);
      return;
    } catch {}
  }
}

async function pull(url: string, tmp: string) {
  const size = existsSync(tmp) ? statSync(tmp).size : 0;
  const res = await fetch(url, {
    headers: size ? { Range: `bytes=${size}-` } : {},
  });
  if (res.status === 416) {
    await res.body?.cancel();
    rmSync(tmp, { force: true });
    throw new Again();
  }
  if (res.status !== 200 && res.status !== 206)
    throw new Error(`${url} が ${res.status} を返した`);
  const fd = openSync(tmp, res.status === 206 ? "a" : "w");
  try {
    for await (const chunk of res.body ?? []) writeSync(fd, chunk);
  } finally {
    closeSync(fd);
  }
}

async function digest(path: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest("hex");
}

function reject(tmp: string, why: string): never {
  rmSync(tmp, { force: true });
  throw new Again(why);
}

/** 照合が済んだ、置くべきファイルを返す。gz は圧縮のまま残して Range の再開が効くよう、解凍は別のファイルに書く */
async function settle(url: string, tmp: string, sha256: string) {
  const bad = `${url} の SHA-256 が合わない`;
  if (!url.endsWith(".gz")) {
    if ((await digest(tmp)) !== sha256) reject(tmp, bad);
    return tmp;
  }
  let data: Buffer;
  try {
    data = gunzipSync(readFileSync(tmp), { maxOutputLength: MAX_UNPACKED });
  } catch {
    reject(tmp, `${url} を解凍できない`);
  }
  if (createHash("sha256").update(data).digest("hex") !== sha256)
    reject(tmp, bad);
  const out = `${tmp.slice(0, -".tmp".length)}.out.tmp`;
  writeFileSync(out, data);
  return out;
}

/** url の中身を dest に置く。sha256 は置く中身(gz は解凍後)の値。dest が既にあれば何もしない */
export async function fetchVerified(
  url: string,
  dest: string,
  sha256: string,
): Promise<void> {
  if (existsSync(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  takeOver(dest, tmp);
  let ready = tmp;
  for (let tries = 2; ; ) {
    try {
      await pull(url, tmp);
      ready = await settle(url, tmp, sha256);
      break;
    } catch (e) {
      if (!(e instanceof Again) || --tries === 0) throw e;
    }
  }
  try {
    renameSync(ready, dest);
  } catch (e) {
    // Windows では別のプロセスが開いている先への rename が失敗する。先に置かれた物は同じ中身
    if (!existsSync(dest)) throw e;
    rmSync(ready, { force: true });
  }
  rmSync(tmp, { force: true });
  for (const p of staleTmps(dest)) rmSync(p, { force: true });
}
