import { expect, test } from "vitest";
import type { Boundary } from "../../src/markdown.ts";
import { align, follow, land, missing, pairKey } from "./round.ts";

test.each([
  [
    "1 文を直すと、同じ数の隙間を並びの順に合わせる",
    "abcd",
    "aXcd",
    [0, 1, 2, 3],
  ],
  ["文を足すと、足した行だけ合わない", "abc", "aXbc", [0, undefined, 1, 2]],
  ["段落を消すと、残った行が前の番号に合う", "abcde", "ade", [0, 3, 4]],
  [
    "2 文を 3 文に書き替えると、隙間の行は合わない",
    "abcd",
    "aXYZd",
    [0, undefined, undefined, undefined, 3],
  ],
  ["真ん中の同じ文は LCS で合わせる", "abcd", "aXcYd", [0, 1, 2, undefined, 3]],
  ["入れ替えた文は同じ文どうしを合わせる", "abcd", "acbd", [0, 2, 1, 3]],
])("%s", (_, old, now, want) => {
  expect(align([...old], [...now])).toEqual(want);
});

test.each<[string, (number | undefined)[], number | null, number | null]>([
  ["残った行はその行へ", [0, 3, 4], 3, 1],
  ["消えた行は後ろで残った行へ", [0, 3, 4], 1, 1],
  ["最後の行が消えると新しい最後の行へ", [0, 1], 2, 1],
  ["選んでいなければ選ばない", [0, 1], null, null],
  ["行が無くなると選ばない", [], 0, null],
  ["入れ替えて前に出た行もその行へ", [0, 2, 1], 1, 2],
  ["どの行も残らなければ選ばない", [undefined, undefined], 0, null],
])("%s", (_, pair, o, want) => {
  expect(follow(pair, o)).toBe(want);
});

test.each<[string, string, string, number, number | null]>([
  ["入れ替えた文は、動いた先の同じ文を選ぶ", "abcd", "acbd", 1, 2],
  ["消した文は、後ろで残った文を選ぶ", "abcde", "ade", 1, 1],
  ["同じ文がいくつもあれば、組んだ行を選ぶ", "abcb", "bbabcb", 3, 5],
  ["同じ文がどれも別の行と組んだなら、番号の近い行を選ぶ", "bXbYb", "bb", 2, 1],
])("選んでいた文の行き先: %s", (_, old, now, o, want) => {
  const pair = align([...old], [...now]);
  expect(land([...old], [...now], pair, o)).toBe(want);
});

const b = (prev: string, next: string): Boundary => ({
  kind: "段落内",
  line: 1,
  heading: "",
  before: "",
  prev,
  next,
  at: 0,
});
const A = b("一。", "二。");
const B = b("二。", "三。");
const MEMO = new Map([[pairKey("r1", "fp16", A), 0.5]]);

test.each([
  ["取り置いた組は判定しない", "r1", "fp16", [A, B], [B]],
  ["版を替えると全部を判定する", "r1", "q8", [A, B], [A, B]],
  ["revision が違うと全部を判定する", "r2", "fp16", [A, B], [A, B]],
  ["同じ組は 1 つにまとめる", "r1", "fp16", [B, { ...B, line: 3 }], [B]],
  [
    "前の前の文だけが違う組は判定する",
    "r1",
    "fp16",
    [{ ...A, before: "零。" }],
    [{ ...A, before: "零。" }],
  ],
  [
    "前の文だけが違う組は判定する",
    "r1",
    "fp16",
    [{ ...A, prev: "別。" }],
    [{ ...A, prev: "別。" }],
  ],
] as const)("%s", (_, rev, v, bs, want) => {
  expect(missing(MEMO, rev, v, bs)).toEqual(want);
});
