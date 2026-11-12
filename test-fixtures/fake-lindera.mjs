import { appendFileSync } from "node:fs";
import { join } from "node:path";

export function nodeSegment() {
  return (text) => {
    appendFileSync(join(process.env.HOME, "bert-in.txt"), `${text}\n`);
    return [text];
  };
}
