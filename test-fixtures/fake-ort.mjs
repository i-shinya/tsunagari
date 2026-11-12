import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const answers = process.env.FAKE_BERT ?? "[]";
let next = 0;

export class Tensor {}
export const InferenceSession = {
  async create(model) {
    writeFileSync(
      join(process.env.HOME, "bert-model.txt"),
      basename(dirname(model)),
    );
    return {
      async run() {
        if (answers === "fail") throw new Error("CUDA が無い");
        const p = JSON.parse(answers)[next++];
        return { logits: { data: [0, Math.log(p / (1 - p))] } };
      },
    };
  },
};
