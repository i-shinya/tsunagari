import type { Doc } from "./markdown.ts";
import { type Context, contextOf, MODE_NAMES, type Mode } from "./providers.ts";

export type Setting = { mode: Mode; context: Context };

const RANGES =
  "all ctx2 s1 s1-ba s2 s2-ba s3 s3-ba s5 s5-ba para para-ba sec sec-ba sec2 sec2-ba full-once full-each";
export const SETTINGS: Record<string, Setting> = Object.fromEntries(
  MODE_NAMES.flatMap((mode) =>
    RANGES.split(" ").flatMap((r) => {
      const context = contextOf(r);
      if (!context) throw new Error(`知らない範囲: ${r}`);
      if (mode !== "default" && context.by === "ctx2") return [];
      return [[r === "full-once" ? mode : `${mode}:${r}`, { mode, context }]];
    }),
  ),
);
export type SettingName = string;

export type Votes = Map<number, number>;
/** 正にする票の線。n は記事の答えのファイルの数 */
export const voteLine = (n: number) => Math.ceil((2 * n) / 3);
export type GoldEntry = {
  id: string;
  at: number;
  leapAt?: number | null;
  kind: string;
  label: string;
  target: string;
};
/** 正解の束を組む材料。conn は接続詞版の答えが 2 つ以上ある記事だけ */
export type Article = {
  id: string;
  genre: string;
  gold: GoldEntry[];
  leapEdits: { at: number; target: string }[];
  base: Votes;
  leap: Votes;
  conn?: { n: number; edits: { kind: string; target: string }[]; votes: Votes };
};
type GoldSet = {
  file(a: Article): string[] | null;
  groups(a: Article, doc: Doc): Map<number, string>;
  votes(a: Article): Votes;
};

const n = (v: Votes, at: number) => v.get(at) ?? 0;
const put = (
  g: Map<number, string>,
  doc: Doc,
  at: number,
  target: string,
  group: string,
) => {
  if (!doc.sentences[at]?.text.startsWith(target))
    throw new Error(`文 ${at} が「${target}」で始まらない`);
  g.set(at, group);
};

// docs/design/bench.md「設定と正解の束」参照
export const GOLD_SETS = {
  "飛躍:元の版": {
    file: (a) => ["gen", "out", a.id, "base.md"],
    groups: (a, doc) => {
      const g = new Map<number, string>();
      for (const x of a.gold)
        if (x.label === "確か(元の文章)")
          put(g, doc, x.at, x.target, "正:元の文章");
      return g;
    },
    votes: (a) => a.base,
  },
  "飛躍:飛躍版": {
    file: (a) => ["gen", "out", a.id, "leap.md"],
    groups: (a, doc) => {
      const g = new Map<number, string>();
      for (const x of a.gold)
        if (x.label === "確か(元の文章)" && x.leapAt != null)
          put(g, doc, x.leapAt, x.target, "正:元の文章");
      for (const x of a.gold)
        if (x.kind !== "元の文章で票が集まった")
          put(
            g,
            doc,
            x.at,
            x.target,
            x.label === "確か" ? `正:${x.kind}` : `(${x.label})`,
          );
      return g;
    },
    votes: (a) => a.leap,
  },
  "接続詞:飛躍版": {
    file: (a) => ["gen", "out", a.id, "leap.md"],
    groups: (a, doc) => {
      const g = new Map<number, string>();
      for (const e of a.leapEdits) put(g, doc, e.at, e.target, "(ほかの手)");
      for (const x of a.gold)
        if (x.kind === "接続の根拠が無い")
          put(
            g,
            doc,
            x.at,
            x.target,
            x.label === "確か" ? "正:接続の根拠が無い" : "(割れた)",
          );
      return g;
    },
    votes: (a) => a.leap,
  },
  "接続詞:接続詞版": {
    file: (a) => (a.conn ? ["conn", "out", a.id, "conn.md"] : null),
    groups: (a, doc) => {
      const g = new Map<number, string>();
      if (!a.conn) return g;
      const line = voteLine(a.conn.n);
      const vb = a.base;
      for (const [at, k] of vb) if (k >= 2) g.set(at, "(元の版で票)");
      for (const e of a.conn.edits) {
        const at = doc.boundaries.find((b) => b.next.startsWith(e.target))?.at;
        if (at === undefined)
          throw new Error(`${a.id}: 「${e.target}」で始まる境目が無い`);
        const v = n(a.conn.votes, at);
        if (e.kind === "合う替え")
          g.set(at, v <= 1 ? "負:合う替え" : "(合う替えに票)");
        else if (n(vb, at) > 1) g.set(at, "(元の版で票)");
        else if (v >= line) g.set(at, `正:${e.kind}`);
        else if (v <= 1) g.set(at, `(見逃し:${e.kind})`);
        else g.set(at, `(割れた:${e.kind})`);
      }
      return g;
    },
    votes: (a) => a.conn?.votes ?? new Map(),
  },
} satisfies Record<string, GoldSet>;
export type GoldSetName = keyof typeof GOLD_SETS;

/** groups は doc.boundaries と同じ順の束。正解に無い境目は、票が 1 以下なら負、ほかは数えない。unplaced は境目の無い文に付いた正解と印の数 */
export function classify(
  name: GoldSetName,
  a: Article,
  doc: Doc,
): { groups: string[]; unplaced: number } {
  const set: GoldSet = GOLD_SETS[name];
  const g = set.groups(a, doc);
  const v = set.votes(a);
  const ats = new Set(doc.boundaries.map((b) => b.at));
  return {
    groups: doc.boundaries.map(
      (b) => g.get(b.at) ?? (n(v, b.at) <= 1 ? "負" : "(票が割れた)"),
    ),
    unplaced: [...g.keys()].filter((at) => !ats.has(at)).length,
  };
}

export type Scored = { id: string; p: number; group: string; head?: string };
const isPos = (r: Scored) => r.group.startsWith("正");
const isNeg = (r: Scored) => r.group.startsWith("負");

/** 低いほど壊れている。正が負より低い組の割合(同じ値は半分)。どちらかが空なら null */
export function auc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null;
  return wins(pos, neg) / (pos.length * neg.length);
}

function wins(pos: number[], neg: number[]): number {
  let w = 0;
  for (const x of pos) for (const y of neg) w += x < y ? 1 : x === y ? 0.5 : 0;
  return w;
}

/** 記事ごとに全部の境目を低い順に並べ、先頭の 10%(切り上げ)と 5 件に入った正を足す */
export function lowRank(rows: Scored[]): { top10: number; top5: number } {
  let top10 = 0;
  let top5 = 0;
  for (const id of new Set(rows.map((r) => r.id))) {
    const s = rows.filter((r) => r.id === id).sort((a, b) => a.p - b.p);
    top10 += s.slice(0, Math.ceil(s.length * 0.1)).filter(isPos).length;
    top5 += s.slice(0, 5).filter(isPos).length;
  }
  return { top10, top5 };
}

/** 接続詞の束に足す行の、束の名前の末尾 */
export const SAME_HEAD = "(同じ語どうし)";

// docs/design/bench.md「表」参照。won[a][b] は記事 a の正が記事 b の負より低かった組、all[a][b] は比べた組
function tally(ids: string[], layers: Scored[][]) {
  const zero = () => ids.map(() => ids.map(() => 0));
  const won = zero();
  const all = zero();
  for (const rows of layers) {
    const of = (id: string, f: (r: Scored) => boolean) =>
      rows.filter((r) => r.id === id && f(r)).map((r) => r.p);
    const neg = ids.map((id) => of(id, isNeg));
    ids.forEach((id, a) => {
      const xs = of(id, isPos);
      neg.forEach((ys, b) => {
        won[a][b] += wins(xs, ys);
        all[a][b] += xs.length * ys.length;
      });
    });
  }
  return { won, all };
}

function width({ won, all }: ReturnType<typeof tally>): string {
  let seed = 1;
  const rnd = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  const v: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const s = won.map(() => Math.floor(rnd() * won.length));
    let w = 0;
    let n = 0;
    for (const a of s)
      for (const b of s) {
        w += won[a][b];
        n += all[a][b];
      }
    if (n) v.push(w / n);
  }
  if (!v.length) return "-";
  v.sort((a, b) => a - b);
  const at = (q: number) => v[Math.floor(v.length * q)].toFixed(2);
  return `${at(0.025)}〜${at(0.975)}`;
}

/** 表の 1 行の数字。sameHead なら、正も負もある文頭の語ごとに、同じ語の正と負だけを比べる */
export function summarize(rows: Scored[], sameHead = false) {
  const layers = sameHead
    ? [...Map.groupBy(rows, (r) => r.head).entries()].flatMap(([head, xs]) =>
        head && xs.some(isPos) && xs.some(isNeg) ? [xs] : [],
      )
    : [rows];
  const ids = [...new Set(rows.map((r) => r.id))];
  const t = tally(ids, layers);
  const sum = (m: number[][]) => m.flat().reduce((s, x) => s + x, 0);
  const n = sum(t.all);
  return {
    articles: ids.length,
    pos: layers.flat().filter(isPos).length,
    neg: layers.flat().filter(isNeg).length,
    auc: n ? (sum(t.won) / n).toFixed(3) : "-",
    width: width(t),
    ...(sameHead ? { top10: "-", top5: "-" } : lowRank(rows)),
  };
}
