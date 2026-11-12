import { existsSync, readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vite";
import { SHEET_CSS } from "../src/sheet.ts";

// docs/design/web.md「配り方」参照
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://huggingface.co https://*.hf.co https://cdn.jsdelivr.net",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; "),
};

// docs/design/web.md「配り方」参照
export const BUNDLED = [
  "lindera-wasm",
  "onnxruntime-web",
  "@fontsource/shippori-mincho",
  "@fontsource/noto-sans-jp",
];

export function licenses(): string {
  return BUNDLED.map((name) => {
    const json = findPackageJSON(name, import.meta.url);
    if (!json) throw new Error(`${name} が見つからない`);
    const pkg = JSON.parse(readFileSync(json, "utf8"));
    const own = join(dirname(json), "LICENSE");
    const file = existsSync(own)
      ? own
      : join(import.meta.dirname, "licenses", `${name}.txt`);
    return `${name} ${pkg.version} (${pkg.license})\n\n${readFileSync(file, "utf8").trim()}\n`;
  }).join("\n----\n\n");
}

export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2024",
    // docs/design/web.md「配り方」参照
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  server: { headers },
  preview: { headers },
  plugins: [
    {
      // docs/design/web.md「ページ」参照
      name: "sheet-css",
      transformIndexHtml: (html) =>
        html.replace("<style>", () => `<style>${SHEET_CSS}`),
    },
    {
      name: "headers-and-drop-ort-wasm",
      generateBundle(_, bundle) {
        // docs/design/web.md「配り方」参照
        for (const k of Object.keys(bundle))
          if (/ort-wasm-.*\.wasm$/.test(k)) delete bundle[k];
        const lines = Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`);
        this.emitFile({
          type: "asset",
          fileName: "_headers",
          source: ["/*", ...lines, ""].join("\n"),
        });
        this.emitFile({
          type: "asset",
          fileName: "licenses.txt",
          source: licenses(),
        });
      },
    },
  ],
  optimizeDeps: { exclude: ["onnxruntime-web", "lindera-wasm"] },
});
