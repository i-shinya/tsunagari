import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, test, vi } from "vitest";
import { fetchVerified } from "./bert-fetch.ts";

const sha = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
const url = "https://example.test/a";
const place = () => join(mkdtempSync(join(tmpdir(), "bert-fetch-")), "a.bin");
const stale = (dest: string, content: string) => {
  const tmp = `${dest}.999.tmp`;
  writeFileSync(tmp, content);
  utimesSync(tmp, 1, 1);
  return tmp;
};
const serve = (...replies: Response[]) => {
  const f = vi.fn(async (_u: string, _i?: RequestInit) => {
    const r = replies.shift();
    if (!r) throw new Error("応答が足りない");
    return r;
  });
  vi.stubGlobal("fetch", f);
  return f;
};
const rangeOf = (f: ReturnType<typeof serve>, call: number) =>
  new Headers(f.mock.calls[call][1]?.headers).get("range");

afterEach(() => vi.unstubAllGlobals());

test("照合が合うと置き、一時ファイルを残さない", async () => {
  const dest = place();
  serve(new Response("abc"));
  await fetchVerified(url, dest, sha("abc"));
  expect(readFileSync(dest, "utf8")).toBe("abc");
  expect(readdirSync(join(dest, ".."))).toEqual(["a.bin"]);
});

test("既に置いてあれば取りに行かない", async () => {
  const dest = place();
  writeFileSync(dest, "x");
  const f = serve();
  await fetchVerified(url, dest, sha("abc"));
  expect(f).not.toHaveBeenCalled();
});

test("gz は解凍した中身で照合して解凍して置く", async () => {
  const dest = place();
  serve(new Response(gzipSync("abc")));
  await fetchVerified(`${url}.gz`, dest, sha("abc"));
  expect(readFileSync(dest, "utf8")).toBe("abc");
});

test("2 回とも照合が合わなければ投げて何も残さない", async () => {
  const dest = place();
  serve(new Response("bad"), new Response("bad"));
  await expect(fetchVerified(url, dest, sha("abc"))).rejects.toThrow(
    "SHA-256 が合わない",
  );
  expect(readdirSync(join(dest, ".."))).toEqual([]);
});

test.each([
  { name: "SHA-256 の不一致", first: () => new Response(gzipSync("bad")) },
  { name: "壊れた gz", first: () => new Response("not gzip") },
])("1 回目が $name なら 1 回だけ取り直して置く", async ({ first }) => {
  const dest = place();
  const f = serve(first(), new Response(gzipSync("abc")));
  await fetchVerified(`${url}.gz`, dest, sha("abc"));
  expect(readFileSync(dest, "utf8")).toBe("abc");
  expect(f).toHaveBeenCalledTimes(2);
  expect(readdirSync(join(dest, ".."))).toEqual(["a.bin"]);
});

test("置いた後に、同じ名前の古い一時ファイルを消す", async () => {
  const dest = place();
  writeFileSync(`${dest}.1.out.tmp`, "x");
  utimesSync(`${dest}.1.out.tmp`, 1, 1);
  serve(new Response("abc"));
  await fetchVerified(url, dest, sha("abc"));
  expect(readdirSync(join(dest, ".."))).toEqual(["a.bin"]);
});

test("HTTP の失敗は状態の番号を付けて投げる", async () => {
  serve(new Response("", { status: 503 }));
  await expect(fetchVerified(url, place(), sha("abc"))).rejects.toThrow("503");
});

test.each([
  {
    name: "206 なら続きを足す",
    reply: () => new Response("c", { status: 206 }),
    calls: 1,
  },
  {
    name: "200 なら先頭から書き直す",
    reply: () => new Response("abc"),
    calls: 1,
  },
])(
  "古い一時ファイルを引き継いで Range で続ける: $name",
  async ({ reply, calls }) => {
    const dest = place();
    const tmp = stale(dest, "ab");
    const f = serve(reply());
    await fetchVerified(url, dest, sha("abc"));
    expect(readFileSync(dest, "utf8")).toBe("abc");
    expect(f).toHaveBeenCalledTimes(calls);
    expect(rangeOf(f, 0)).toBe("bytes=2-");
    expect(existsSync(tmp)).toBe(false);
  },
);

test("416 なら一時ファイルを捨てて先頭から取り直す", async () => {
  const dest = place();
  stale(dest, "abc");
  const f = serve(new Response("", { status: 416 }), new Response("abc"));
  await fetchVerified(url, dest, sha("abc"));
  expect(readFileSync(dest, "utf8")).toBe("abc");
  expect(rangeOf(f, 1)).toBeNull();
});

test("書いている途中の新しい一時ファイルは引き継がない", async () => {
  const dest = place();
  const other = `${dest}.999.tmp`;
  writeFileSync(other, "ab");
  const f = serve(new Response("abc"));
  await fetchVerified(url, dest, sha("abc"));
  expect(rangeOf(f, 0)).toBeNull();
  expect(readFileSync(other, "utf8")).toBe("ab");
});
