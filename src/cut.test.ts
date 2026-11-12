import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type Cut, describe, lowest, NO_CUT, readCut } from "./cut.ts";

const dir = mkdtempSync(join(tmpdir(), "tsunagari-cut-"));
let n = 0;
const settings = (text?: string) => {
  const file = join(dir, `settings-${n++}.env`);
  if (text !== undefined) writeFileSync(file, text);
  return file;
};

test("何も無ければ NO_CUT そのものを返す", () => {
  expect(readCut({}, settings())).toBe(NO_CUT);
});

test.each([
  {
    env: { TSUNAGARI_MAX_SCORE: "0.3" },
    want: { maxScore: 0.3, maxCount: null },
  },
  { file: "TSUNAGARI_MAX_COUNT=5\n", want: { maxScore: null, maxCount: 5 } },
  {
    file: 'export TSUNAGARI_MAX_SCORE="0.25"\r\n',
    want: { maxScore: 0.25, maxCount: null },
  },
  {
    env: { TSUNAGARI_MAX_SCORE: "0.2" },
    file: "TSUNAGARI_MAX_SCORE=0.5\nTSUNAGARI_MAX_COUNT=3\n",
    want: { maxScore: 0.2, maxCount: 3 },
  },
  {
    env: { TSUNAGARI_MAX_SCORE: "" },
    file: "TSUNAGARI_MAX_SCORE=0.5\n",
    want: NO_CUT,
  },
])("環境変数 $env と設定 $file から $want を読む", ({ env, file, want }) => {
  expect(readCut(env ?? {}, settings(file))).toEqual(want);
});

test.each([
  ["TSUNAGARI_MAX_SCORE", ["abc", "1.5", "-0.1", "NaN", "Infinity"]],
  ["TSUNAGARI_MAX_COUNT", ["0", "2.5", "-1", "x"]],
])("%s が誤った値なら名前を含む文を返す", (name, bad) => {
  for (const v of bad) {
    expect(readCut({ [name]: v }, settings())).toContain(name);
    expect(readCut({}, settings(`${name}=${v}\n`))).toContain(name);
  }
});

const cut = (maxScore: number | null, maxCount: number | null): Cut => ({
  maxScore,
  maxCount,
});

test.each([
  { ps: [0.5, 0.1, 0.9], cut: NO_CUT, want: [0.1, 0.5, 0.9] },
  { ps: [0.5, 0.1, 0.9], cut: cut(0.5, null), want: [0.1, 0.5] },
  { ps: [0.304, 0.306], cut: cut(0.3, null), want: [0.304] },
  { ps: [0.5, 0.1, 0.9], cut: cut(null, 1), want: [0.1] },
  { ps: [0.5, 0.1, 0.9], cut: cut(0.5, 1), want: [0.1] },
  { ps: [0.5, 0.1, 0.9], cut: cut(0.05, null), want: [] },
])("lowest($ps, $cut) は $want", ({ ps, cut, want }) => {
  expect(
    lowest(
      ps.map((p) => ({ p })),
      cut,
    ).map((r) => r.p),
  ).toEqual(want);
});

test("件数の境で同じスコアが並ぶと、記事の順で前のものを残す", () => {
  const rows = [0.2, 0.2, 0.2].map((p, i) => ({ p, i }));
  expect(lowest(rows, cut(null, 2)).map((r) => r.i)).toEqual([0, 1]);
});

test.each([
  { cut: cut(0.3, null), want: "スコア 0.3 以下" },
  { cut: cut(null, 5), want: "低い順 5 件まで" },
  { cut: cut(0.3, 5), want: "スコア 0.3 以下、低い順 5 件まで" },
])("describe($cut) は $want", ({ cut, want }) => {
  expect(describe(cut)).toBe(want);
});
