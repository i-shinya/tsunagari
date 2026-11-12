// cli.test.ts が NODE_OPTIONS=--import で読み、worker の onnxruntime-node と lindera を偽物にする
import { registerHooks } from "node:module";

const fake = (name) => ({
  url: new URL(`./${name}`, import.meta.url).href,
  shortCircuit: true,
});
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "onnxruntime-node") return fake("fake-ort.mjs");
    if (/bert-lindera\.(ts|js)$/.test(specifier))
      return fake("fake-lindera.mjs");
    return next(specifier, context);
  },
});
