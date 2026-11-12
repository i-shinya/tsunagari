import { expect, test } from "vitest";
import { parse } from "./markdown.ts";
import { starts } from "./page.ts";

test.each([
  ["1 行に 3 文", "一つ目の文です。二つ目の文です。三つ目の文です。", [8, 16]],
  ["箇条の行", "最初の文です。\n- 箇条の一つ目です。", [2]],
  [
    "同じ文が並ぶ行",
    "走った。疲れた。走った。疲れた。走った。眠った。",
    [4, 8, 12, 16, 20],
  ],
  [
    "頭の字が行の後ろにも出る段落の頭",
    "前の文です。\n\nそこで歩いた。今日は走った。そう思う、そこ。",
    [0, 7, 14],
  ],
])("%s の境目の印の列は、行の中の後ろの文の頭になる", (_, md, want) => {
  expect(starts(md, parse(md, false).boundaries)).toEqual(want);
});
