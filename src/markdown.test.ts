import { expect, test } from "vitest";
import { context, parse, type Range } from "./markdown.ts";

const kinds = (md: string, includeLists = false) =>
  parse(md, includeLists).boundaries.map((b) => [b.kind, b.line]);

test.each([
  {
    name: "文の間",
    md: "一つ目の文です。二つ目の文です。",
    want: [["段落内", 1]],
  },
  {
    name: "段落の間",
    md: "一つ目の段落です。\n\n二つ目の段落です。",
    want: [["段落間", 3]],
  },
  {
    name: "見出しをまたぐ境目は数えない",
    md: "前の節の文です。\n\n## 見出し\n\n次の節の文です。",
    want: [],
  },
  {
    name: "画像だけの行をはさんだ段落どうしを比べ、alt は文に数えない",
    md: "前の段落です。\n\n![図の説明です。](a.png)\n\n後の段落です。",
    want: [["段落間", 5]],
  },
  {
    name: "画像だけの行のあとの見出しをまたぐ境目は数えない",
    md: "前の段落です。\n\n![図の説明です。](a.png)\n\n## 見出し\n\n後の段落です。",
    want: [],
  },
  {
    name: "段落から箇条へ、項目どうしは既定で数えない",
    md: "段落の文です。\n- 項目の一つ目です。\n- 項目の二つ目です。",
    want: [["箇条へ", 2]],
  },
  {
    name: "includeLists で項目どうしを数える",
    md: "段落の文です。\n- 項目の一つ目です。\n- 項目の二つ目です。",
    includeLists: true,
    want: [
      ["箇条へ", 2],
      ["項目間", 3],
    ],
  },
  {
    name: "4 字下げの入れ子の項目も項目として、既定で数えない",
    md: "- 親の項目\n    - 子の項目の一つ目です。\n    - 子の項目の二つ目です。",
    want: [],
  },
  {
    name: "includeLists で入れ子の項目どうしを数える",
    md: "- 親の項目\n    - 子の項目の一つ目です。\n    - 子の項目の二つ目です。",
    includeLists: true,
    want: [
      ["項目間", 2],
      ["項目間", 3],
    ],
  },
  {
    name: "引用の中の入れ子の項目も項目として、既定で数えない",
    md: "> - 引用の項目です。\n>     - 引用の子の項目です。",
    want: [],
  },
  {
    name: "セルの中だけを見る",
    md: "| 見出しの列 |\n|---|\n| 一つ目の文です。二つ目の文です。 |\n\n段落の文です。",
    want: [["セル内", 3]],
  },
  {
    name: "コードの囲みと frontmatter は文に数えず、前後の段落をつなぐ",
    md: "---\ntitle: 題です。\n---\n前の文です。\n```mermaid\ngraph の中です。\n```\n```\nコードの中です。\n```\n後の文です。",
    want: [["段落間", 11]],
  },
  {
    name: ":::message の中身は読み、印は落とす",
    md: "前の段落です。\n\n:::message\n囲みの中の文です。\n:::",
    want: [["段落間", 4]],
  },
  {
    name: "CRLF でも行番号は LF と同じ",
    md: "一つ目の段落です。\r\n\r\n二つ目の段落です。続きの文です。",
    want: [
      ["段落間", 3],
      ["段落内", 3],
    ],
  },
])("$name", ({ md, includeLists, want }) => {
  expect(kinds(md, includeLists)).toEqual(want);
});

test("段落の頭の境目は、その段落の中の境目より前に並ぶ", () => {
  const doc = parse("一の文です。\n\n二の一の文です。二の二の文です。", false);
  expect(doc.boundaries.map((b) => b.at)).toEqual([1, 2]);
});

test("context は記事の頭から対象の文までを、対象に印を付けて返す", () => {
  const doc = parse(
    "## 節\n\n一つ目の文です。二つ目の文です。三つ目の文です。",
    false,
  );
  expect(context(doc, doc.boundaries[0])).toBe(
    "## 節\n一つ目の文です。【対象】二つ目の文です。【/対象】",
  );
});

const ranged = parse(
  "前置きの文です。\n\n## 一つ目\n\n一の一の文です。一の二の文です。\n\n## 二つ目\n\n二の一の文です。二の二の文です。\n\n二の三の文です。二の四の文です。二の五の文です。",
  false,
);
const S1 = "## 一つ目\n一の一の文です。一の二の文です。\n## 二つ目\n";
const HEAD =
  "二の一の文です。二の二の文です。\n【対象】二の三の文です。【/対象】";
const MID = "二の三の文です。【対象】二の四の文です。【/対象】";

test.each<{ at: string; range: Range; want: string }>([
  {
    at: "二の三",
    range: { by: "all" },
    want: `前置きの文です。\n${S1}${HEAD}`,
  },
  {
    at: "二の三",
    range: { by: "sents", n: 1, after: false },
    want: "二の二の文です。\n【対象】二の三の文です。【/対象】",
  },
  {
    at: "二の三",
    range: { by: "sents", n: 1, after: true },
    want: "二の二の文です。\n【対象】二の三の文です。【/対象】二の四の文です。",
  },
  { at: "二の三", range: { by: "para", after: false }, want: HEAD },
  {
    at: "二の三",
    range: { by: "para", after: true },
    want: `${HEAD}二の四の文です。二の五の文です。`,
  },
  {
    at: "二の二",
    range: { by: "para", after: true },
    want: "二の一の文です。【対象】二の二の文です。【/対象】\n二の三の文です。二の四の文です。二の五の文です。",
  },
  { at: "二の三", range: { by: "sec", n: 2, after: false }, want: S1 + HEAD },
  { at: "二の四", range: { by: "sents", n: 1, after: false }, want: MID },
  {
    at: "二の四",
    range: { by: "sents", n: 2, after: true },
    want: `二の二の文です。\n${MID}二の五の文です。`,
  },
  { at: "二の四", range: { by: "para", after: false }, want: MID },
  {
    at: "二の四",
    range: { by: "sec", n: 1, after: false },
    want: `二の一の文です。二の二の文です。\n${MID}`,
  },
  {
    at: "二の四",
    range: { by: "sec", n: 1, after: true },
    want: `二の一の文です。二の二の文です。\n${MID}二の五の文です。`,
  },
  {
    at: "二の四",
    range: { by: "sec", n: 2, after: true },
    want: `${S1}二の一の文です。二の二の文です。\n${MID}二の五の文です。`,
  },
])("context は $at を対象に、範囲 $range の文を返す", ({ at, range, want }) => {
  const b = ranged.boundaries.find((x) => x.next.startsWith(at));
  expect(b && context(ranged, b, undefined, range)).toBe(want);
});

test.each([
  {
    name: "前の見出しの下に文が無ければ、文のある見出しまでさかのぼる",
    md: "前置きの文です。\n\n## 大\n\n### 小\n\n小の一の文です。小の二の文です。",
    want: "前置きの文です。\n## 小\n小の一の文です。【対象】小の二の文です。【/対象】",
  },
  {
    name: "前に文が無ければ、今の見出しの下だけ",
    md: "# 題\n\n## 節\n\n節の一の文です。節の二の文です。",
    want: "## 節\n節の一の文です。【対象】節の二の文です。【/対象】",
  },
])("context の sec2 は、$name", ({ md, want }) => {
  const doc = parse(md, false);
  expect(
    context(doc, doc.boundaries[0], undefined, {
      by: "sec",
      n: 2,
      after: false,
    }),
  ).toBe(want);
});

test("before は前の文の 1 つ前の文で、見出しをまたぐと空になる", () => {
  expect(ranged.boundaries.map((b) => b.before)).toEqual([
    "",
    "",
    "二の一の文です。",
    "二の二の文です。",
    "二の三の文です。",
  ]);
});
