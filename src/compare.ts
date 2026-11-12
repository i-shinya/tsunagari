function ranks(v: number[]): number[] {
  const order = [...v.keys()].sort((a, b) => v[a] - v[b]);
  const r = new Array<number>(v.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && v[order[j + 1]] === v[order[i]]) j++;
    for (let k = i; k <= j; k++) r[order[k]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

/** 順位の相関。同じ値は平均の順位にする。3 件未満か、どちらかが全部同じ値なら null */
export function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const m = (n - 1) / 2;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i] - m) * (ry[i] - m);
    vx += (rx[i] - m) ** 2;
    vy += (ry[i] - m) ** 2;
  }
  return vx && vy ? cov / Math.sqrt(vx * vy) : null;
}
