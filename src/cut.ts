import { readKeys } from "./providers.ts";

/** 使う人の足切り。null はその軸で切らない。両方あれば両方を満たす境目だけを残す */
export type Cut = {
  readonly maxScore: number | null;
  readonly maxCount: number | null;
};
export const NO_CUT: Cut = Object.freeze({ maxScore: null, maxCount: null });

const SCORE = "TSUNAGARI_MAX_SCORE";
const COUNT = "TSUNAGARI_MAX_COUNT";

/** 環境変数か設定のファイルから読む。誤った値は文で返す。どちらも無ければ NO_CUT そのもの */
export function readCut(env: NodeJS.ProcessEnv, file: string): Cut | string {
  const fromFile = readKeys({}, file, [SCORE, COUNT]);
  // 空の環境変数はファイルの値を消す(その回だけ切らない)
  const raw = (name: string) =>
    (Object.hasOwn(env, name) ? env[name] : fromFile[name])?.trim() || null;
  const s = raw(SCORE);
  const c = raw(COUNT);
  const maxScore = s === null ? null : Number(s);
  if (maxScore !== null && !(maxScore >= 0 && maxScore <= 1))
    return `${SCORE} は 0 から 1 の数: ${s}(環境変数か ${file})`;
  if (c !== null && !(/^\d+$/.test(c) && Number(c) >= 1))
    return `${COUNT} は 1 以上の整数: ${c}(環境変数か ${file})`;
  const maxCount = c === null ? null : Number(c);
  return maxScore === null && maxCount === null
    ? NO_CUT
    : { maxScore, maxCount };
}

/** 低い順(同じなら記事の順)に並べ、足切りを通るものだけを返す。結果はいつも低い順の頭の部分 */
export function lowest<T extends { p: number }>(
  rows: readonly T[],
  cut: Cut,
): T[] {
  const sorted = rows.toSorted((x, y) => x.p - y.p);
  const { maxScore, maxCount } = cut;
  // 見えている 2 桁の値で比べる。0.30 と出る行は 0.30 で残る
  const passed =
    maxScore === null
      ? sorted
      : sorted.filter((r) => Number(r.p.toFixed(2)) <= maxScore);
  return maxCount === null ? passed : passed.slice(0, maxCount);
}

/** 標準エラーと HTML の見出しに出す足切りの説明 */
export function describe(cut: Cut): string {
  return [
    cut.maxScore === null ? "" : `スコア ${cut.maxScore} 以下`,
    cut.maxCount === null ? "" : `低い順 ${cut.maxCount} 件まで`,
  ]
    .filter(Boolean)
    .join("、");
}
