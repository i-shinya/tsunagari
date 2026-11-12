import { expect, test } from "vitest";
import {
  type Article,
  auc,
  classify,
  type GoldSetName,
  lowRank,
  SETTINGS,
  summarize,
} from "./accuracy.ts";
import { parse } from "./markdown.ts";
import { CONTEXTS, contextOf } from "./providers.ts";

test("設定の範囲は CLI の範囲の表の形を 1 つ以上ずつ持ち、connectives と connectives-choice に ctx2 は無い", () => {
  const ranges = Object.keys(SETTINGS).map(
    (s) => s.split(":")[1] ?? "full-once",
  );
  for (const r of ranges) expect(contextOf(r)).toBeDefined();
  expect(SETTINGS["connectives:ctx2"]).toBeUndefined();
  expect(SETTINGS["connectives-choice:ctx2"]).toBeUndefined();
  for (const shape of CONTEXTS.split(", ")) {
    const re = new RegExp(`^${shape.replace("<N>", "\\d+")}$`);
    expect(
      ranges.some((r) => re.test(r)),
      shape,
    ).toBe(true);
  }
});

test("名前の無い設定は CLI の既定(full-once)を指し、all は名前を付けて選ぶ", () => {
  expect(SETTINGS.default.context).toEqual(contextOf("full-once"));
  expect(SETTINGS.connectives.context).toEqual(contextOf("full-once"));
  expect(SETTINGS["connectives-choice"].context).toEqual(
    contextOf("full-once"),
  );
  expect(SETTINGS["default:all"].context).toEqual(contextOf("all"));
});

test.each([
  { name: "正が全部低ければ 1", pos: [0.1, 0.2], neg: [0.5, 0.6], want: 1 },
  { name: "同じ値は半分", pos: [0.5], neg: [0.5, 0.9], want: 0.75 },
  { name: "正が空なら null", pos: [], neg: [0.5], want: null },
  { name: "負が空なら null", pos: [0.5], neg: [], want: null },
])("auc: $name", ({ pos, neg, want }) => {
  expect(auc(pos, neg)).toBe(want);
});

test("lowRank は記事ごとに低い順の 10%(切り上げ)と 5 件に入った正を足す", () => {
  const rows = [
    ...[0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((p, i) => ({
      id: "a",
      p,
      group: i === 0 ? "正:x" : i === 4 ? "正:y" : "負",
    })),
    { id: "b", p: 0.9, group: "(票が割れた)" },
    { id: "b", p: 0.1, group: "正:z" },
  ];
  expect(lowRank(rows)).toEqual({ top10: 2, top5: 3 });
});

test("summarize は正と負だけを数え、幅は同じ入力で同じ", () => {
  const rows = ["a", "b", "c"].flatMap((id) => [
    { id, p: 0.1, group: "正:x" },
    { id, p: 0.9, group: "負" },
    { id, p: 0.5, group: "(割れた)" },
  ]);
  const m = summarize(rows);
  expect(m).toMatchObject({ articles: 3, pos: 3, neg: 3, auc: "1.000" });
  expect(m.width).toBe("1.00〜1.00");
  expect(summarize(rows).width).toBe(m.width);
});

test("summarize の幅は、記事で点の向きが違えば開き、乱数の種が固定の値になる", () => {
  const rows = ["a", "b", "c", "d"].flatMap((id, i) => [
    { id, p: 0.1 + i * 0.2, group: "正:x" },
    { id, p: 0.9 - i * 0.2, group: "負" },
    { id, p: 0.5, group: "負" },
  ]);
  expect(summarize(rows)).toMatchObject({ auc: "0.641", width: "0.08〜1.00" });
});

test.each([
  {
    name: "語をまたいで組の数で足す(そのため 1/1 組、しかし 0/2 組)",
    p: [0.6, 0.7, 0.5, 0.5, 0.2],
    auc: "0.333",
    width: "0.33〜0.33",
  },
  {
    name: "点が文頭の語だけで決まれば 0.5",
    p: [0.3, 0.3, 0.8, 0.8, 0.8],
    auc: "0.500",
    width: "0.50〜0.50",
  },
])(
  "summarize の同じ語どうしは、同じ文頭の語の正と負だけを比べる: $name",
  ({ p, auc, width }) => {
    const rows = [
      { id: "a", p: p[0], group: "正:x", head: "そのため" },
      { id: "b", p: p[1], group: "負", head: "そのため" },
      { id: "a", p: p[2], group: "正:x", head: "しかし" },
      { id: "a", p: p[3], group: "正:x", head: "しかし" },
      { id: "b", p: p[4], group: "負", head: "しかし" },
      { id: "a", p: 0.1, group: "正:x", head: "つまり" },
      { id: "c", p: 0.05, group: "負" },
    ];
    expect(summarize(rows, true)).toMatchObject({
      articles: 3,
      pos: 3,
      neg: 2,
      auc,
      width,
      top10: "-",
      top5: "-",
    });
  },
);

test("同じ語どうしの幅は、相手のある語が無ければ - になる", () => {
  const rows = [
    { id: "a", p: 0.1, group: "正:x", head: "つまり" },
    { id: "a", p: 0.9, group: "負" },
  ];
  expect(summarize(rows, true)).toMatchObject({ auc: "-", width: "-" });
});

const doc = parse(
  "# 見出し\n\nあの文だ。しかしいの文だ。うの文だ。えの文だ。おの文だ。\n",
  false,
);
const votes = (o: Record<number, number>) =>
  new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
const article = (over: Partial<Article>): Article => ({
  id: "x",
  genre: "種類なし",
  gold: [],
  leapEdits: [],
  base: new Map(),
  leap: new Map(),
  ...over,
});
const g = (at: number, kind: string, label: string, leapAt?: number) => ({
  id: "x",
  at,
  kind,
  label,
  leapAt,
  target: doc.sentences[leapAt ?? at].text.slice(0, 3),
});
const e = (at: number) => ({ at, target: doc.sentences[at].text });

test.each<{ name: string; set: GoldSetName; a: Article; want: string[] }>([
  {
    name: "元の版は確か(元の文章)が正、票 1 以下が負、割れた票は外す",
    set: "飛躍:元の版",
    a: article({
      gold: [g(1, "元の文章で票が集まった", "確か(元の文章)")],
      base: votes({ 2: 1, 3: 2 }),
    }),
    want: ["正:元の文章", "負", "(票が割れた)", "負"],
  },
  {
    name: "飛躍版は leapAt を正にし、確かでない飛躍は括弧で外す",
    set: "飛躍:飛躍版",
    a: article({
      gold: [
        g(1, "元の文章で票が集まった", "確か(元の文章)", 2),
        g(3, "指すもの", "確か"),
        g(4, "指すもの", "見逃し"),
      ],
    }),
    want: ["負", "正:元の文章", "正:指すもの", "(見逃し)"],
  },
  {
    name: "接続詞の飛躍版はほかの手を外し、接続の根拠が無いを正にする",
    set: "接続詞:飛躍版",
    a: article({
      leapEdits: [e(1), e(2)],
      gold: [g(2, "接続の根拠が無い", "確か"), g(3, "接続の根拠が無い", "割")],
    }),
    want: ["(ほかの手)", "正:接続の根拠が無い", "(割れた)", "負"],
  },
  {
    name: "接続詞版は n=7 の線(票 5)以上の替えを正、票の無い合う替えを負、元の版の票を外す",
    set: "接続詞:接続詞版",
    a: article({
      base: votes({ 4: 2 }),
      conn: {
        n: 7,
        edits: [
          { kind: "文頭・替え", target: "しかしいの" },
          { kind: "合う替え", target: "うの" },
          { kind: "文頭・替え", target: "えの" },
        ],
        votes: votes({ 1: 5, 3: 3 }),
      },
    }),
    want: [
      "正:文頭・替え",
      "負:合う替え",
      "(割れた:文頭・替え)",
      "(元の版で票)",
    ],
  },
  {
    name: "接続詞版は n=4 なら票 3 以上を正にする",
    set: "接続詞:接続詞版",
    a: article({
      conn: {
        n: 4,
        edits: [
          { kind: "文頭・替え", target: "しかしいの" },
          { kind: "合う替え", target: "うの" },
          { kind: "文頭・替え", target: "えの" },
        ],
        votes: votes({ 1: 3, 2: 2, 3: 2 }),
      },
    }),
    want: ["正:文頭・替え", "(合う替えに票)", "(割れた:文頭・替え)", "負"],
  },
])("classify: $name", ({ set, a, want }) => {
  expect(classify(set, a, doc).groups).toEqual(want);
});

test("正解の文が target で始まらなければ投げる", () => {
  const a = article({
    gold: [{ ...g(2, "指すもの", "確か"), target: "えの" }],
  });
  expect(() => classify("飛躍:飛躍版", a, doc)).toThrow("えの");
});

test("境目の無い文の正解は数えず、その数を返す", () => {
  const a = article({
    gold: [g(0, "指すもの", "確か"), g(2, "指すもの", "確か")],
  });
  const r = classify("飛躍:飛躍版", a, doc);
  expect(r.unplaced).toBe(1);
  expect(r.groups.filter((x) => x.startsWith("正"))).toHaveLength(1);
});
