import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, expect, test, vi } from "vitest";
import { cudaDir, cudaReady, pickFiles, setupCuda } from "./bert-cuda.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const place = () => mkdtempSync(join(tmpdir(), "bert-cuda-"));
function zipOf(content: string) {
  const zip = new AdmZip();
  zip.addFile("lib/a.so", Buffer.from(content));
  const path = join(place(), "a.zip");
  zip.writeZip(path);
  return path;
}

test("書庫から取り出し、照合して 0644 で書く", async () => {
  const dest = place();
  await pickFiles(
    zipOf("abc"),
    [{ entry: "lib/a.so", file: "a.so", sha: sha("abc") }],
    dest,
  );
  expect(readFileSync(join(dest, "a.so"), "utf8")).toBe("abc");
  expect(statSync(join(dest, "a.so")).mode & 0o777).toBe(0o644);
});

test.each([
  { name: "SHA-256 が合わない", entry: "lib/a.so", want: "SHA-256 が合わない" },
  { name: "書庫に無い", entry: "lib/b.so", want: "書庫に無い" },
])("$name と投げる", async ({ entry, want }) => {
  await expect(
    pickFiles(zipOf("abc"), [{ entry, file: "a.so", sha: sha("x") }], place()),
  ).rejects.toThrow(want);
});

const archives = [
  {
    name: "a.zip",
    url: "https://example.invalid/a.zip",
    sha: "",
    provider: false,
    files: [{ entry: "lib/a.so", file: "a.so", sha: sha("abc") }],
  },
];
// dl/ に書庫を先に置くと fetchVerified は取りに行かない
function cudaHome() {
  const home = place();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  const dl = join(home, ".cache", "tsunagari", "cuda", "dl");
  mkdirSync(dl, { recursive: true });
  copyFileSync(zipOf("abc"), join(dl, "a.zip"));
  return { dl, base: dirname(dl) };
}
function finish(dir: string) {
  const ort = join(dir, "node_modules", "onnxruntime-node");
  mkdirSync(ort, { recursive: true });
  writeFileSync(join(ort, "package.json"), "{}");
}
afterEach(() => vi.unstubAllEnvs());

test("確かめに失敗すると、写しを消し、取得物を残して投げる", async () => {
  const { dl, base } = cudaHome();
  await expect(setupCuda(async () => "載らない", archives)).rejects.toThrow(
    "GPU で動かせない: 載らない",
  );
  expect(readdirSync(base)).toEqual(["dl"]);
  expect(existsSync(join(dl, "a.zip"))).toBe(true);
});

test("確かめに失敗しても、別のプロセスが先に完成させていれば成功する", async () => {
  cudaHome();
  await setupCuda(async () => {
    finish(cudaDir());
    return "dl を消された";
  }, archives);
  expect(cudaReady()).toBe(true);
});

test("成功すると置き場所に移し、取得物と古い版を消す", async () => {
  const { base } = cudaHome();
  mkdirSync(join(base, "1.0.0-linux-x64"));
  await setupCuda(async (dir) => {
    finish(dir);
    return undefined;
  }, archives);
  expect(cudaReady()).toBe(true);
  expect(existsSync(join(cudaDir(), "libs", "a.so"))).toBe(true);
  expect(readdirSync(base)).toEqual([cudaDir().split(/[\\/]/).pop()]);
});
