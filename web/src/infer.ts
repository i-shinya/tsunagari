import * as lindera from "lindera-wasm";
import type { Boundary } from "../../src/markdown.ts";
import { createTokenizer, linderaSegment } from "../../src/tokenize.ts";
import type { Assets, Variant } from "./store.ts";

export type Backend = "webgpu" | "wasm";
/** run は境目ごとの p を記事の順で返す。CLI と同じく 4 桁に丸める */
export type Judge = {
  readonly run: (
    bs: readonly Boundary[],
    onStep: (done: number) => void,
  ) => Promise<number[]>;
  readonly release: () => Promise<void>;
};

/** WebGPU のセッションを作れなかった、または WebGPU の推論が失敗した */
export class GpuError extends Error {}

const both = (why: string) => ({ fp16: why, q8: why });
/** 版ごとの WebGPU で動かせない理由。動かせるなら undefined */
export async function gpuGaps(): Promise<Record<Variant, string | undefined>> {
  try {
    const a = await navigator.gpu?.requestAdapter();
    if (!a) return both("GPU の adapter がありません");
    if (a.info?.isFallbackAdapter ?? Reflect.get(a, "isFallbackAdapter"))
      return both("GPU の adapter が CPU で動く代わりのものです");
    return {
      fp16: a.features.has("shader-f16")
        ? undefined
        : "GPU が shader-f16 を持ちません",
      q8: undefined,
    };
  } catch (e) {
    return both(e instanceof Error ? e.message : String(e));
  }
}

export async function openJudge(
  a: Assets,
  backend: Backend,
  threads: number,
): Promise<Judge> {
  // ORT の pthread の worker は ORT を含む chunk を読み直すので、画面のコードと別の chunk に置く
  const [ort] = await Promise.all([
    import("onnxruntime-web/webgpu"),
    lindera.default(),
  ]);
  const tokenize = createTokenizer(a.vocab, linderaSegment(lindera, a.dict));
  // docs/design/web.md「配り方」参照
  ort.env.wasm.wasmPaths = {
    wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/ort-wasm-simd-threaded.asyncify.wasm`,
  };
  // docs/design/web.md「backend の選び方」参照
  ort.env.wasm.proxy = true;
  ort.env.wasm.numThreads = threads;
  const fail = (e: unknown): never => {
    if (backend !== "webgpu") throw e;
    throw new GpuError(e instanceof Error ? e.message : String(e));
  };
  const session = await ort.InferenceSession.create(a.model, {
    executionProviders: [backend],
  }).catch(fail);
  const ints = (xs: readonly number[]) =>
    new ort.Tensor("int64", BigInt64Array.from(xs, BigInt), [1, xs.length]);
  return {
    async run(bs, onStep) {
      const ps: number[] = [];
      for (const b of bs) {
        // src/bert.ts と同じ組
        const { inputIds, attentionMask } = tokenize(
          [b.before, b.prev].filter(Boolean).join(" "),
          b.next,
        );
        const out = await session
          .run({
            input_ids: ints(inputIds),
            attention_mask: ints(attentionMask),
            token_type_ids: ints(inputIds.map(() => 0)),
          })
          .catch(fail);
        const z = out.logits.data as Float32Array;
        if (!z.every(Number.isFinite))
          fail(new Error("判定の値が数になりませんでした"));
        ps.push(Math.round(1e4 / (1 + Math.exp(z[0] - z[1]))) / 1e4);
        onStep(ps.length);
      }
      return ps;
    },
    release: () => session.release(),
  };
}
