import { expect, test } from "vitest";
import { type Cut, NO_CUT } from "./cut.ts";
import { renderHtml } from "./html.ts";
import { parse } from "./markdown.ts";

const html = (md: string, ps: number[], cut: Cut = NO_CUT, first = "bert") =>
  renderHtml(
    "dir/a.md",
    md,
    parse(md, false).boundaries.map((b, i) => ({ ...b, p: ps[i] })),
    cut,
    first,
  );
const nums = (out: string) =>
  [...out.matchAll(/<span class="v">([\d.]+)</g)].map((m) => m[1]);
const data = (out: string) =>
  JSON.parse(
    out.match(
      /<script type="application\/json" id="data">(.*)<\/script>/,
    )?.[1] ?? "[]",
  ) as { next: string; copy?: string }[];
const four = "一つ目の文です。二つ目の文です。三つ目の文です。四つ目の文です。";
const byCount = { maxScore: null, maxCount: 2 };

test("スコアの高い境目にも余白の数が付く", () => {
  expect(nums(html(four, [0.1, 0.99, 0.5]))).toEqual(["0.10", "0.99", "0.50"]);
});

test("本文と埋め込みの文から script の閉じタグが外に出ず、埋め込んだ script は JS として読める", () => {
  const out = html("一つ目の文です。</script><b>二つ目</b>の文です。", [0.5]);
  expect(out.match(/<\/script>/g)).toHaveLength(2);
  const code = /<script>([\s\S]*?)<\/script>/.exec(out)?.[1] ?? "";
  expect(() => new Function(code)).not.toThrow();
});

test("足切りで落ちた文は数も印も無く選べず、要約はすべての境目を数え、残った数を注記に出す", () => {
  const out = html(four, [0.9, 0.1, 0.5], byCount);
  expect(nums(out)).toEqual(["0.10", "0.50"]);
  expect(out).not.toMatch(/data-i="0"/);
  expect(out).toContain(
    "判定した 3 文のうち <b>0.5 未満 1 文</b>(ふつうの記事は 3 割ほど)。数を出したのは 2 文(低い順 2 件まで)",
  );
});

test.each([
  ["bert", "判定: bert"],
  ["<b>", "判定: &lt;b&gt;"],
])("最初の provider が %s なら、要約に %s と出る", (first, note) => {
  expect(html(four, [0.9, 0.1, 0.5], NO_CUT, first)).toContain(note);
});

test.each([
  ["ふつうの文です。", "ふつうの文です。"],
  [
    "行の終わりで切れていて、\n次の行に続く文です。",
    "行の終わりで切れていて、",
  ],
  ["括弧の中で（行を\n折った）文です。", "括弧の中で（行を折った）文です。"],
  ["設定は `bar` を渡す。", "設定は bar を渡す。"],
  ["次は **太字**。", "次は 太字。"],
  ["最後は [リンク](http://x.y)。", "最後は リンク。"],
])(
  "%j の文をコピーすると、md の記号と行の終わりに足した「。」だけを外した %j になる",
  (md, want) => {
    const d = data(
      html(`最初の文はここにあります。\n\n${md}`, [0.5, 0.5]),
    ).find((x) => x.next.startsWith(md.slice(0, 2)));
    expect(d?.copy ?? d?.next).toBe(want);
  },
);
