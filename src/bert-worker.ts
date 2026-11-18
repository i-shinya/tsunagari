// node bert-worker <重み> <backend> <入力> <出力> [CUDA の置き場所]。docs/design/cli.md「BERT」参照
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Ort from "onnxruntime-node";
import type { Backend } from "./bert.ts";
import { dictPath, fetchAssets, modelPath, vocabPath } from "./bert-assets.ts";
import type { Weights } from "./bert-files.ts";
import { nodeSegment } from "./bert-lindera.ts";
import {
  createTokenizer,
  DICT_FILES,
  type DictFiles,
  type Tokenize,
} from "./tokenize.ts";

const [weights, backend, src, dst, cuda] = process.argv.slice(2) as [
  Weights,
  Backend,
  string,
  string,
  string,
];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
function die(code: number, why: string): never {
  console.error(`bert-error: ${why}`);
  process.exit(code);
}

const PROVIDERS = {
  dml: ["dml"],
  webgpu: ["webgpu"],
  cuda: ["cuda"],
  cpu: ["cpu"],
};

try {
  await fetchAssets(weights);
} catch (e) {
  die(3, `重みを取れない: ${message(e)}`);
}

const entry =
  backend === "cuda"
    ? pathToFileURL(
        join(cuda, "node_modules", "onnxruntime-node", "dist", "index.js"),
      ).href
    : "onnxruntime-node";
const ort: typeof Ort = await import(entry).catch((e) =>
  die(
    backend === "cuda" ? 1 : 3,
    `onnxruntime を読めない: ${message(e)}${process.platform === "win32" ? "。Microsoft Visual C++ 再頒布可能パッケージを入れる" : ""}`,
  ),
);

let pairs: [string, string][];
let tokenize: Tokenize;
try {
  pairs = JSON.parse(readFileSync(src, "utf8"));
  const dict = Object.fromEntries(
    DICT_FILES.map((n) => [n, new Uint8Array(readFileSync(dictPath(n)))]),
  ) as DictFiles;
  tokenize = createTokenizer(
    readFileSync(vocabPath(), "utf8"),
    nodeSegment(dict),
  );
} catch (e) {
  die(3, `区切りの用意ができない: ${message(e)}`);
}

const gpuFail = (e: unknown) => die(backend === "cpu" ? 3 : 1, message(e));
const session = await ort.InferenceSession.create(modelPath(weights), {
  executionProviders: PROVIDERS[backend],
}).catch(gpuFail);
const ints = (xs: readonly number[]) =>
  new ort.Tensor("int64", BigInt64Array.from(xs, BigInt), [1, xs.length]);

const out: number[] = [];
for (const [a, b] of pairs) {
  const { inputIds, attentionMask } = tokenize(a, b);
  const r = await session
    .run({
      input_ids: ints(inputIds),
      attention_mask: ints(attentionMask),
      token_type_ids: ints(inputIds.map(() => 0)),
    })
    .catch(gpuFail);
  const z = r.logits.data as Float32Array;
  if (!z.every(Number.isFinite)) gpuFail("判定の値が数になりませんでした");
  out.push(Math.round(1e4 / (1 + Math.exp(z[0] - z[1]))) / 1e4);
}
writeFileSync(dst, JSON.stringify(out));
process.exit(0);
