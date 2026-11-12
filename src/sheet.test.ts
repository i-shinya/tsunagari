import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "./markdown.ts";
import { client, doc, lay, type Mark, summary, view } from "./sheet.ts";

const T = client();
const marks = (md: string, ps: (number | null)[]): Mark[] =>
  parse(md, false).boundaries.map((b, i) => ({ ...b, p: ps[i] ?? null }));

test("lay は 1 文 1 行にし、番号は境目のある文と節の頭の文だけに振り、続きの行と短い文は前の行にまとめる", () => {
  const md = [
    "# 題",
    "",
    "一つ目の文です。二つ目の文です。短い。三つ目の文です。",
    "括弧の中で（行を",
    "折った）文です。",
    "",
    "- 項目の一つです。",
    "- 項目の二つです。",
    "",
    "```",
    "code",
    "```",
  ].join("\r\n");
  const lines = lay(md, marks(md, [0.5, 0.5, 0.5, 0.5]));
  expect(
    lines.map((l) =>
      l.t === "s"
        ? [l.no, l.text, l.i, l.li]
        : [l.t, "text" in l ? l.text : ""],
    ),
  ).toEqual([
    ["title", "題"],
    [1, "一つ目の文です。", null, false],
    [2, "二つ目の文です。短い。", 0, false],
    [3, "三つ目の文です。", 1, false],
    [4, "括弧の中で（行を折った）文です。", 2, false],
    ["gap", ""],
    [5, "項目の一つです。", 3, true],
    [6, "項目の二つです。", null, true],
    ["gap", ""],
    ["code", "code"],
  ]);
});

test.each([
  ["短い文をまとめた行", ["一つ目の文です。二つ目の文です。短い。三つ目。"]],
  ["箇条", ["- **項目の**一つです。次の文です。", "- 項目の二つです。"]],
  ["引用", ["> 引用の文です。次の文です。"]],
  ["表", ["| 列 | 列 |", "|---|---|", "| 表の文です。 | 次の文です。 |"]],
  ["続きの行", ["括弧の中で（行を", "  折った）文です。次の文です。"]],
])(
  "lay の文の行の範囲は、元の文章の行の頭の記号を除いた文字列(%s、LF と CRLF)",
  (_, ls) => {
    for (const nl of ["\n", "\r\n"]) {
      const md = ls.join(nl);
      const rows = marks(md, []);
      const got = lay(md, rows).flatMap((l) =>
        l.t === "s" ? [md.slice(l.from, l.to)] : [],
      );
      const want = lay(md, rows).flatMap((l) => (l.t === "s" ? [l.text] : []));
      expect(got.map((s) => s.replace(/\r?\n\s*/g, ""))).toEqual(want);
      expect(got.every((s) => s === s.trim() && !/^[-*>]\s/.test(s))).toBe(
        true,
      );
    }
  },
);

test.each([
  [
    "閉じた frontmatter と複数行のコメント",
    [
      "---",
      "a: 1",
      "---",
      "<!--",
      "中の行です。",
      "-->",
      "一つ目の文です。二つ目の文です。",
    ],
    [1, 2],
  ],
  ["閉じの無い ---", ["---", "一つ目の文です。二つ目の文です。"], [1, 2]],
  [
    "囲みの中の閉じないコメント",
    [
      "```html",
      "<!-- 閉じない例",
      "```",
      "",
      "一つ目の文です。二つ目の文です。",
    ],
    [1, 2],
  ],
])("%s は文の番号を取らず、parse と同じ文だけに番号が付く", (_, raw, want) => {
  const md = raw.join("\n");
  const lines = lay(md, marks(md, [0.5]));
  expect(lines.flatMap((l) => (l.t === "s" ? [l.no] : []))).toEqual(want);
});

test.each([
  [
    "**強調**の文です。二つ目の文です。",
    ["**強調**の文です。", "二つ目の文です。"],
  ],
  ["[リンク](https://x.y)の文です。", ["[リンク](https://x.y)の文です。"]],
  ["`npm` を使う文です。", ["`npm` を使う文です。"]],
  ["前の文です。**強調**の文です。", ["前の文です。", "**強調**の文です。"]],
  [
    "| 列の文です。 |\n|---|\n| セルの文です。 |",
    ["| 列の文です。 |", "| セルの文です。 |"],
  ],
])("記号で始まる段落 %j も、記号ごと 1 文 1 行になる", (body, want) => {
  const md = `前の段落の文です。\n\n${body}`;
  const lines = lay(md, marks(md, [0.5, 0.5, 0.5]));
  expect(lines.flatMap((l) => (l.t === "s" ? [l.text] : [])).slice(1)).toEqual(
    want,
  );
});

test.each([
  [["---", "a: 1", "---", "# 題", "", "本文の文です。"], "title"],
  [["  ## 見出し", "", "本文の文です。"], "h"],
])("%j の最初の見出しの形は %s になる", (raw, want) => {
  const md = raw.join("\n");
  expect(lay(md, marks(md, [])).find((l) => l.t !== "aside")?.t).toBe(want);
});

test("ほかに大きく変わった文に、足切りで落ちた文は出ない", () => {
  const md = "一つ目の文です。二つ目の文です。三つ目の文です。";
  const rows = marks(md, [0.1, 0.9]);
  rows[1].was = 0.1;
  expect(
    T.card(view(rows, [true, false]), { bert: true }, 0, "low"),
  ).not.toContain("ほかに大きく変わった文");
  expect(T.card(view(rows), { bert: true }, 0, "low")).toContain(
    "ほかに大きく変わった文",
  );
});

test.each([
  [undefined, 1],
  [null, null],
  [0, 0],
  [2, 1],
])("開いたときに選ぶ文は、前の回の %s から %s になる", (cur, want) => {
  const md = "一つ目の文です。二つ目の文です。三つ目の文です。四つ目の文です。";
  const D = view(marks(md, [0.5, 0.1, 0.3]), [true, true, false]);
  expect(T.first(D, cur)).toBe(want);
});

test.each([
  [0.1, "w"],
  [0.19, "w"],
  [0.199, "y"],
  [0.49, "y"],
  [0.497, ""],
  [0.9, ""],
])("見える 2 桁で比べ、%s の印の段は %j になる", (p, want) => {
  expect(T.cls(p)).toBe(want);
});

test("本文は、足切りで落ちた文に数も印も付けず、未判定の文に「未判定」、0.05 以上上がった文に ▲ を出す", () => {
  const md = "一つ目の文です。二つ目の文です。三つ目の文です。四つ目の文です。";
  const rows = marks(md, [0.1, null, 0.6]);
  rows[2].was = 0.3;
  const out = doc(lay(md, rows), view(rows, [true, true, false]));
  expect(out).not.toMatch(/data-i="2"/);
  expect(out).toMatch(/class="tg-row" data-i="1"/);
  expect(out).toContain('<span class="pend">未判定</span>');
  expect(out).toMatch(/class="tg-row w" data-i="0"/);
  expect(out).toContain('<span class="v">0.10</span>');
  const up = view(rows, [true, true, true]);
  expect(doc(lay(md, rows), up)).toContain('<span class="d up">▲</span>');
});

test("本文の文は HTML として読まれない", () => {
  const md = "一つ目の文です。</script><b>二つ目</b>の文です。";
  const rows = marks(md, [0.5]);
  expect(doc(lay(md, rows), view(rows))).not.toMatch(/<\/script>|<b>/);
});

test("並べ方の順は、落ちた文と未判定の文を除き、低い順は同じ数なら本文の順にする", () => {
  const md =
    "一つ目の文です。二つ目の文です。三つ目の文です。四つ目の文です。五つ目の文です。";
  const D = view(marks(md, [0.5, null, 0.2, 0.5]), [true, true, true, false]);
  expect(T.order(D, "low")).toEqual([2, 0]);
  expect(T.order(D, "doc")).toEqual([0, 2]);
});

test.each([
  [null, 1, 2],
  [null, -1, 0],
  [2, 1, 0],
  [0, 1, 0],
  [0, -1, 2],
])("低い順 [2, 0] で %s から %s 動くと %s になる", (cur, d, want) => {
  expect(T.go([2, 0], cur, d)).toBe(want);
});

test.each([
  [0.12, 0.64, '0.12 → 0.64(<span class="up">+0.52</span>)'],
  [0.64, 0.12, '0.64 → 0.12(<span class="dn">−0.52</span>)'],
  [0.5, 0.52, '0.50 → 0.52(<span class="eq">+0.02</span>)'],
  [0.501, 0.499, "0.50 から(変わらず)"],
])(
  "前の回 %s から %s に変わると、カードの差は増減だけに色を付けた %j になる",
  (was, p, want) => {
    expect(T.moved(was, p)).toBe(want);
  },
);

test("ほかに大きく変わった文のリンクは、増減に色を付けずリンクの色のまま出す", () => {
  const D = view(
    marks("一つ目の文です。二つ目の文です。三つ目の文です。", [0.1, 0.8]),
  );
  D[1].was = 0.2;
  expect(T.card(D, { bert: true }, 0, "low")).toContain(
    'data-go="1">2 番 0.20 → 0.80(+0.60)</button>',
  );
});

test.each([
  ["low", "低い順の一覧"],
  ["doc", "出てくる順の一覧"],
] as const)(
  "並べ方が %s なら、シートの頭のボタンは %j になる",
  (mode, want) => {
    const D = view(marks("一つ目の文です。二つ目の文です。", [0.1]));
    expect(T.side(D, { bert: true }, 0, mode)).toContain(
      `data-act="sheet">${want}</button>`,
    );
  },
);

test.each([
  [true, true],
  [false, false],
])(
  "bert が %s なら、カードに範囲・前の 2 文、分布に灰の帯を出す: %s",
  (bert, shown) => {
    const md = "一つ目の文です。二つ目の文です。三つ目の文です。";
    const D = view(marks(md, [0.9, 0.1]));
    const opts = { bert };
    expect(
      T.card(D, opts, 1, "low").includes("ふつうの記事の範囲より低い"),
    ).toBe(shown);
    expect(T.card(D, opts, 1, "low").includes("一つ目の文です。")).toBe(shown);
    expect(T.dist(D, opts).includes('class="band"')).toBe(shown);
  },
);

test("未判定の文を選ぶと、そのまま選び、カードは判定し直すまで数が出ないことだけを書く", () => {
  const D = view(
    marks("一つ目の文です。二つ目の文です。三つ目の文です。", [0.1, null]),
  );
  expect(T.first(D, 1)).toBe(1);
  expect(T.card(D, { bert: true, fix: true }, 1, "low")).toBe(
    '<div class="k">2 番の文</div><div class="empty">この文は直した後まだ判定していません。判定し直すと数が出ます。</div>',
  );
});

test("カードの「この文を直す」は fix を渡したときだけ出る", () => {
  const D = view(marks("一つ目の文です。二つ目の文です。", [0.1]));
  expect(T.card(D, { bert: true }, 0, "low")).not.toContain("この文を直す");
  expect(T.card(D, { bert: true, fix: true }, 0, "low")).toContain(
    "この文を直す",
  );
});

test("分布と要約は、落ちた文も含めたすべての判定した境目を表示の 2 桁で数え、未判定は数えない", () => {
  const md =
    "一つ目の文です。二つ目の文です。三つ目の文です。四つ目の文です。五つ目の文です。六つ目の文です。";
  const rows = marks(md, [0.1, 0.49, 0.497, 0.5, null]);
  const D = view(rows, [true, false, true, true, true]);
  expect(T.bins(D)).toEqual([0, 1, 0, 0, 1, 2, 0, 0, 0, 0]);
  expect(summary(rows, true)).toBe(
    "判定した 4 文のうち <b>0.5 未満 2 文</b>(ふつうの記事は 3 割ほど)",
  );
  expect(summary(rows, false)).toBe("判定した 4 文のうち <b>0.5 未満 2 文</b>");
});

test("埋め込む sheet.ts の源に、script を途中で閉じる </script と <!-- が無い", () => {
  const src = readFileSync(new URL("./sheet.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/<\/script|<!--/i);
});
