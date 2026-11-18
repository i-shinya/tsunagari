import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { type Backend, firstBackend, judge } from "./bert.ts";
import { ORT_VERSION } from "./bert-files.ts";

test("ORT_VERSION は package.json の onnxruntime-node の固定した版と同じ", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { dependencies: Record<string, string> };
  expect(pkg.dependencies["onnxruntime-node"]).toBe(ORT_VERSION);
});

test.each([
  { platform: "win32", cuda: false, want: "dml" },
  { platform: "darwin", cuda: false, want: "webgpu" },
  { platform: "linux", cuda: false, want: "cpu" },
  { platform: "linux", cuda: true, want: "cuda" },
] as const)(
  "$platform(CUDA の用意 $cuda)は $want から始める",
  ({ platform, cuda, want }) => {
    expect(firstBackend(platform, cuda)).toBe(want);
  },
);

type Reply = { code: number | null; why?: string; out?: unknown };
const script = (replies: Partial<Record<Backend, Reply>>) =>
  vi.fn(async (b: Backend) => ({
    code: 0,
    why: "",
    out: undefined,
    ...replies[b],
  }));

test("GPU で動けば CPU を起こさず答えを返す", async () => {
  const run = script({ dml: { code: 0, out: [0.5] } });
  await expect(judge("dml", 1, run)).resolves.toEqual([0.5]);
  expect(run).toHaveBeenCalledTimes(1);
});

test.each([
  { name: "終わり方 1", reply: { code: 1, why: "壊れた" } },
  { name: "signal", reply: { code: null, why: "終わり方 SIGSEGV" } },
  { name: "答えの形が違う", reply: { code: 0, out: [] } },
])("GPU が失敗すると CPU でやり直す: $name", async ({ reply }) => {
  const run = script({ dml: reply, cpu: { code: 0, out: [0.5] } });
  await expect(judge("dml", 1, run)).resolves.toEqual([0.5]);
  expect(run.mock.calls.map(([b]) => b)).toEqual(["dml", "cpu"]);
});

test("終わり方 3 は振り替えずに bert の失敗にする", async () => {
  const run = script({ dml: { code: 3, why: "取れない" } });
  await expect(judge("dml", 1, run)).rejects.toThrow("bert: 取れない");
  expect(run).toHaveBeenCalledTimes(1);
});

test.each([
  { reply: { code: 1, why: "壊れた" }, want: "bert: 壊れた" },
  { reply: { code: 0, out: [0.5, 2] }, want: "bert: 答えの形が違う" },
])("CPU の失敗は $want で投げる", async ({ reply, want }) => {
  await expect(judge("cpu", 2, script({ cpu: reply }))).rejects.toThrow(want);
});
