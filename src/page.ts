import type { Boundary } from "./markdown.ts";

/** was は前の回の p。Web だけが付け、付いた境目には前の回からの動きを出す */
export type Row = Boundary & { p: number; was?: number };
export type Order = "doc" | "low";
/** 読み手がいた所。境目の番号と px だけで、本文は入れない */
export type Seen = {
  readonly cur: number | null;
  readonly mode: Order;
  readonly top: { readonly i: number; readonly dy: number } | null;
};

// 後ろの文は md の記号を外した形なので、頭を短くしながら元の行の中を探す。同じ行の前の印より後ろを先に 20 字の頭で探し(短い頭は段落の頭の文が行の後ろの別の文に当たる)、無ければ印を置いた位置だけを飛ばす
function findStart(raw: string, next: string, used: Set<number>) {
  const after = used.size ? Math.max(...used) + 1 : 0;
  const ahead = raw.indexOf(next.slice(0, 20), after);
  if (ahead >= 0) return ahead;
  for (const n of [20, 10, 6, 3, 1]) {
    const head = next.slice(0, n);
    for (let at = raw.indexOf(head); at >= 0; at = raw.indexOf(head, at + 1))
      if (!used.has(at)) return at;
  }
  return 0;
}

/** 境目ごとに、印を置く列(その行の中の位置) */
export function starts(text: string, rows: readonly Boundary[]): number[] {
  const lines = text.split(/\r\n?|\n/);
  const used = new Map<number, Set<number>>();
  return rows.map((r) => {
    const seen = used.get(r.line) ?? new Set<number>();
    const at = findStart(lines[r.line - 1] ?? "", r.next, seen);
    used.set(r.line, seen.add(at));
    return at;
  });
}
