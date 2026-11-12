import type { Boundary } from "../../src/markdown.ts";
import type { Variant } from "./store.ts";

/** 判定の取り置き。鍵は pairKey、値は p */
export type Memo = ReadonlyMap<string, number>;
/** pair[j] は新しい行 j に当たる前の行の番号。undefined は足した行 */
export type Pair = readonly (number | undefined)[];

/** 前後の同じ所を落とし、残りを next の LCS で合わせ、同じ数の隙間は並びの順に合わせる */
export function align(old: readonly string[], now: readonly string[]): Pair {
  const pair = Array<number | undefined>(now.length).fill(undefined);
  let a = 0;
  while (a < old.length && a < now.length && old[a] === now[a]) pair[a] = a++;
  let zo = old.length;
  let zn = now.length;
  while (zo > a && zn > a && old[zo - 1] === now[zn - 1]) pair[--zn] = --zo;
  const n = zo - a;
  const m = zn - a;
  const gap = (oi: number, oe: number, ni: number, ne: number) => {
    if (oe - oi === ne - ni)
      for (let k = 0; k < ne - ni; k++) pair[a + ni + k] = a + oi + k;
  };
  // shortcut: 真ん中が大きく違う長い文章では LCS の表を作らず、隙間として扱う。数万の境目を毎回直すなら差分の算法を替える
  if (n * m > 4e6) {
    gap(0, n, 0, m);
    return moved(old, now, pair);
  }
  const w = m + 1;
  const len = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      len[i * w + j] =
        old[a + i] === now[a + j]
          ? len[(i + 1) * w + j + 1] + 1
          : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
  let [i, j, gi, gj] = [0, 0, 0, 0];
  while (i < n && j < m) {
    if (old[a + i] === now[a + j]) {
      gap(gi, i, gj, j);
      pair[a + j] = a + i;
      gi = ++i;
      gj = ++j;
    } else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
    else j++;
  }
  gap(gi, n, gj, m);
  return moved(old, now, pair);
}

// 入れ替えた文は LCS から外れるので、残った行の中で同じ文どうしを合わせる
function moved(
  old: readonly string[],
  now: readonly string[],
  pair: (number | undefined)[],
): Pair {
  const used = new Set(pair);
  const free = new Map<string, number[]>();
  old.forEach((t, i) => {
    if (!used.has(i)) free.set(t, [...(free.get(t) ?? []), i]);
  });
  pair.forEach((o, j) => {
    if (o === undefined) pair[j] = free.get(now[j])?.shift();
  });
  return pair;
}

/** 前の行 o の行き先。消えた行は後ろで残った行、無ければ最後の行。どの行も残らなければ選ばない */
export function follow(pair: Pair, o: number | null): number | null {
  if (o === null || pair.every((x) => x === undefined)) return null;
  const at = pair.indexOf(o);
  if (at >= 0) return at;
  const j = pair.findIndex((x) => x !== undefined && x > o);
  return j < 0 ? pair.length - 1 : j;
}

/** 前の行 o を選んでいたときに選ぶ今の行。同じ文の行(複数なら o と組んだ行、無ければ番号の近い行)、無ければ follow */
export function land(
  old: readonly string[],
  now: readonly string[],
  pair: Pair,
  o: number | null,
): number | null {
  if (o === null) return null;
  const same = now.flatMap((t, j) => (t === old[o] ? [j] : []));
  if (same.length === 0) return follow(pair, o);
  const near = (a: number, j: number) =>
    Math.abs(j - o) < Math.abs(a - o) ? j : a;
  return same.find((j) => pair[j] === o) ?? same.reduce(near);
}

export const pairKey = (revision: string, v: Variant, b: Boundary): string =>
  [revision, v, b.before, b.prev, b.next].join("\0");

/** 取り置きに無い境目。同じ鍵は 1 つにまとめる */
export function missing(
  memo: Memo,
  revision: string,
  v: Variant,
  bs: readonly Boundary[],
): Boundary[] {
  const seen = new Set<string>();
  return bs.filter((b) => {
    const k = pairKey(revision, v, b);
    if (memo.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
