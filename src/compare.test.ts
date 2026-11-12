import { expect, test } from "vitest";
import { spearman } from "./compare.ts";

test.each([
  { name: "同じ順なら 1", xs: [0.1, 0.5, 0.9], ys: [1, 2, 3], want: 1 },
  { name: "逆の順なら -1", xs: [0.1, 0.5, 0.9], ys: [3, 2, 1], want: -1 },
  // 並べた順に順位を付けると 0.4 になる
  {
    name: "同じ値は平均の順位",
    xs: [1, 2, 3, 4],
    ys: [0.99, 0.99, 0.5, 0.99],
    want: -1 / Math.sqrt(15),
  },
  { name: "3 件未満は null", xs: [1, 2], ys: [1, 2], want: null },
  { name: "全部同じ値は null", xs: [1, 2, 3], ys: [0.5, 0.5, 0.5], want: null },
])("spearman: $name", ({ xs, ys, want }) => {
  const rho = spearman(xs, ys);
  if (want === null) expect(rho).toBeNull();
  else expect(rho).toBeCloseTo(want);
});
