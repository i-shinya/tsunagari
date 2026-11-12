import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchVerified } from "./bert-fetch.ts";
import {
  DICT_DIR,
  DICT_SHA,
  HF,
  MODEL_SHA,
  REVISION,
  VOCAB_SHA,
  type Weights,
} from "./bert-files.ts";
import { DICT_FILES } from "./tokenize.ts";

const root = () =>
  join(homedir(), ".cache", "tsunagari", "bert-onnx", REVISION);
export const modelPath = (w: Weights) => join(root(), w, "model.onnx");
export const vocabPath = () => join(root(), "vocab.txt");
export const dictPath = (n: string) => join(root(), DICT_DIR, n);

/** 重み・vocab・辞書を、無ければ公開の Hugging Face から取って照合して置く */
export async function fetchAssets(w: Weights): Promise<void> {
  if (!existsSync(modelPath(w)))
    console.error(`bert: 重み(${w})を初めて取る。数分かかる`);
  await fetchVerified(`${HF}${w}/model.onnx`, modelPath(w), MODEL_SHA[w]);
  await fetchVerified(`${HF}vocab.txt`, vocabPath(), VOCAB_SHA);
  for (const n of DICT_FILES)
    await fetchVerified(`${HF}${DICT_DIR}/${n}.gz`, dictPath(n), DICT_SHA[n]);
}
