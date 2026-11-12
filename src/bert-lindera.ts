import { readFileSync } from "node:fs";
import * as lindera from "lindera-wasm";
import { type DictFiles, linderaSegment, type Segment } from "./tokenize.ts";

/** Node では default() が fetch で wasm を読もうとして落ちるので initSync で初期化する */
export function nodeSegment(dict: DictFiles): Segment {
  lindera.initSync({
    module: readFileSync(
      new URL("lindera_wasm_bg.wasm", import.meta.resolve("lindera-wasm")),
    ),
  });
  return linderaSegment(lindera, dict);
}
