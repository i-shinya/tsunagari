import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchVerified } from "./bert-fetch.ts";
import { CUDA_ARCHIVES, ORT_VERSION } from "./bert-files.ts";

const base = () => join(homedir(), ".cache", "tsunagari", "cuda");
const NATIVE = join("bin", "napi-v6", "linux", "x64");

export const cudaDir = () => join(base(), `${ORT_VERSION}-linux-x64`);
const ortDir = (dir: string) => join(dir, "node_modules", "onnxruntime-node");
export const libsOf = (dir: string) => join(dir, "libs");
export const cudaReady = () =>
  existsSync(join(ortDir(cudaDir()), "package.json"));
export const hasNvidia = () =>
  spawnSync("nvidia-smi", ["-L"], { stdio: "ignore", timeout: 5000 }).status ===
  0;

type Pick = {
  readonly entry: string;
  readonly file: string;
  readonly sha: string;
};
type Archive = {
  readonly name: string;
  readonly url: string;
  readonly sha: string;
  readonly provider: boolean;
  readonly files: readonly Pick[];
};

/** 書庫の entry を照合して dest に 0644 で書く */
export async function pickFiles(
  zipPath: string,
  picks: readonly Pick[],
  dest: string,
) {
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(zipPath);
  mkdirSync(dest, { recursive: true });
  for (const p of picks) {
    const data = zip.getEntry(p.entry)?.getData();
    if (!data) throw new Error(`書庫に無い: ${p.entry}`);
    if (createHash("sha256").update(data).digest("hex") !== p.sha)
      throw new Error(`${p.file} の SHA-256 が合わない`);
    writeFileSync(join(dest, p.file), data, { mode: 0o644 });
  }
}

function copyOrt(work: string) {
  const req = createRequire(import.meta.url);
  const from = dirname(
    dirname(fileURLToPath(import.meta.resolve("onnxruntime-node"))),
  );
  const to = ortDir(work);
  mkdirSync(join(to, NATIVE), { recursive: true });
  cpSync(join(from, "dist"), join(to, "dist"), { recursive: true });
  cpSync(join(from, "package.json"), join(to, "package.json"));
  // 手元の clone の postinstall が置いた provider は照合していないので写さない
  for (const f of readdirSync(join(from, NATIVE)))
    if (!f.startsWith("libonnxruntime_providers_"))
      cpSync(join(from, NATIVE, f), join(to, NATIVE, f));
  const common = req.resolve("onnxruntime-common", { paths: [from] });
  let root = dirname(common);
  while (basename(root) !== "onnxruntime-common") root = dirname(root);
  cpSync(root, join(work, "node_modules", "onnxruntime-common"), {
    recursive: true,
  });
}

/** CUDA のライブラリと provider を取り、probe で GPU に載ることを確かめて置く。docs/design/cli.md「init」参照 */
export async function setupCuda(
  probe: (dir: string) => Promise<string | undefined>,
  archives: readonly Archive[] = CUDA_ARCHIVES,
): Promise<void> {
  if (cudaReady()) return;
  const dl = join(base(), "dl");
  let work: string | undefined;
  try {
    for (const a of archives)
      await fetchVerified(a.url, join(dl, a.name), a.sha);
    work = mkdtempSync(join(base(), "tmp-"));
    copyOrt(work);
    for (const a of archives)
      await pickFiles(
        join(dl, a.name),
        a.files,
        a.provider ? join(ortDir(work), NATIVE) : libsOf(work),
      );
    const why = await probe(work);
    if (why !== undefined) throw new Error(`GPU で動かせない: ${why}`);
    renameSync(work, cudaDir());
  } catch (e) {
    if (work) rmSync(work, { recursive: true, force: true });
    // 同時に走った別の init の完成と掃除で失敗したときも、できていれば成功
    if (cudaReady()) return;
    throw e;
  }
  for (const n of readdirSync(base()))
    if (n !== basename(cudaDir()))
      rmSync(join(base(), n), { recursive: true, force: true });
}
