import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { checkBundle, main, stripPostinstall } from "./prepack.ts";

const NM = "node_modules";
const ORT = join(NM, "onnxruntime-node");
const TARGETS = [
  "win32/x64",
  "win32/arm64",
  "darwin/arm64",
  "linux/x64",
  "linux/arm64",
];
const binding = (t: string) =>
  join(ORT, "bin", "napi-v6", ...t.split("/"), "onnxruntime_binding.node");
const provider = join(
  ORT,
  "bin",
  "napi-v6",
  "linux",
  "x64",
  "libonnxruntime_providers_cuda.so",
);

function put(root: string, file: string, body: string | object = "") {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  const text = typeof body === "string" ? body : JSON.stringify(body);
  writeFileSync(join(root, file), text);
}

const lock = {
  packages: {
    "": { dependencies: { a: "1.0.0", "onnxruntime-node": "2.0.0" } },
    "node_modules/a": { version: "1.0.0" },
    "node_modules/a/node_modules/c": { version: "1.0.0" },
    "node_modules/@s/b": { version: "3.1.0" },
    "node_modules/onnxruntime-node": { version: "2.0.0" },
  },
};

/** 展開した tarball に見立てた木と、npm ci したての木を作る */
function bundle() {
  const fresh = mkdtempSync(join(tmpdir(), "prepack-"));
  put(fresh, "package.json", { dependencies: lock.packages[""].dependencies });
  put(fresh, join(NM, "a", "package.json"), {
    version: "1.0.0",
    dependencies: { "@s/b": "^3.0.0", c: "1.0.0" },
  });
  put(fresh, join(NM, "a", NM, "c", "package.json"), { version: "1.0.0" });
  put(fresh, join(NM, "@s", "b", "package.json"), { version: "3.1.0" });
  put(fresh, join(NM, "@s", "b", "index.js"), "ok");
  put(fresh, join(ORT, "package.json"), {
    version: "2.0.0",
    scripts: { postinstall: "node script/install", prepare: "tsc" },
  });
  for (const t of TARGETS) put(fresh, binding(t));
  put(fresh, "package-lock.json", lock);
  const root = mkdtempSync(join(tmpdir(), "prepack-"));
  cpSync(fresh, root, { recursive: true });
  return { root, fresh };
}

test("stripPostinstall は onnxruntime-node の postinstall だけを消す", () => {
  const { root } = bundle();
  stripPostinstall(root);
  const pkg = JSON.parse(readFileSync(join(root, ORT, "package.json"), "utf8"));
  expect(pkg.scripts).toEqual({ prepare: "tsc" });
});

test("stripPostinstall は NuGet の provider が残っていると投げる", () => {
  const { root } = bundle();
  put(root, provider);
  expect(() => stripPostinstall(root)).toThrow("ONNXRUNTIME_NODE_INSTALL=skip");
});

test("checkBundle は postinstall を消しただけの木で問題を返さない", () => {
  const { root, fresh } = bundle();
  stripPostinstall(root);
  expect(checkBundle(root, lock, fresh)).toEqual([]);
});

const bPkg = join(NM, "@s", "b", "package.json");
const manifest = (r: string) =>
  JSON.parse(readFileSync(join(r, "package.json"), "utf8"));

test.each<[string, (root: string, fresh: string) => void, string]>([
  ["postinstall が残る", () => {}, "onnxruntime-node: postinstall"],
  [
    "別の依存の install",
    (r) => put(r, bPkg, { version: "3.1.0", scripts: { install: "x" } }),
    "@s/b: install",
  ],
  [
    "root の postinstall",
    (r) =>
      put(r, "package.json", { ...manifest(r), scripts: { postinstall: "x" } }),
    "tsunagari: postinstall",
  ],
  [
    "binding.gyp",
    (r) => put(r, join(NM, "a", "binding.gyp")),
    "a: binding.gyp",
  ],
  ["lock と違う版", (r) => put(r, bPkg, { version: "3.2.0" }), "@s/b: 3.2.0"],
  [
    "入れ子の依存の版が違う",
    (r) => put(r, join(NM, "a", NM, "c", "package.json"), { version: "2.0.0" }),
    "c: 2.0.0",
  ],
  [
    "lock に無いパッケージ",
    (r) => put(r, join(NM, "x", "package.json"), {}),
    "x: undefined",
  ],
  [
    "依存が木に無い",
    (r) => rmSync(join(r, NM, "@s"), { recursive: true }),
    "a: @s/b",
  ],
  [
    "optional の依存が木に無い",
    (r) =>
      put(r, join(NM, "a", NM, "c", "package.json"), {
        version: "1.0.0",
        optionalDependencies: { gone: "1.0.0" },
      }),
    "c: gone",
  ],
  [
    "peer の依存が木に無い",
    (r) =>
      put(r, join(NM, "a", NM, "c", "package.json"), {
        version: "1.0.0",
        peerDependencies: { gone: "1.0.0" },
      }),
    "c: gone",
  ],
  [
    "lock の実行の依存を宣言ごと落とす",
    (r) => {
      put(r, "package.json", { dependencies: { "onnxruntime-node": "2.0.0" } });
      rmSync(join(r, NM, "a"), { recursive: true });
    },
    "tsunagari: a",
  ],
  [
    "node_modules が無い",
    (r) => rmSync(join(r, NM), { recursive: true }),
    "tsunagari: a",
  ],
  [
    "OS のバイナリが無い",
    (r) => rmSync(join(r, binding("darwin/arm64"))),
    "darwin/arm64",
  ],
  ["provider が混ざる", (r) => put(r, provider), "providers"],
  [
    "同梱のファイルの中身が npm ci と違う",
    (r) => put(r, join(NM, "@s", "b", "index.js"), "evil"),
    "@s/b: index.js",
  ],
  [
    "npm ci に無いファイルが足されている",
    (r) => put(r, join(NM, "@s", "b", "extra.js"), "evil"),
    "@s/b: extra.js",
  ],
  [
    "onnxruntime-node の package.json を postinstall の外で変える",
    (r) =>
      put(r, join(ORT, "package.json"), {
        version: "2.0.0",
        scripts: { prepare: "evil" },
      }),
    "onnxruntime-node: package.json",
  ],
])("checkBundle は %s を問題として返す", (name, breakIt, want) => {
  const { root, fresh } = bundle();
  if (name !== "postinstall が残る") stripPostinstall(root);
  breakIt(root, fresh);
  expect(checkBundle(root, lock, fresh).join("\n")).toContain(want);
});

test.each([[["--check"]], [["--check", ""]], [["--chek", "x"]], [["x"]]])(
  "main は %j を使い方の誤りの 2 にして何も書き換えない",
  (args) => {
    const { root } = bundle();
    const before = readFileSync(join(root, ORT, "package.json"), "utf8");
    expect(main(args, root)).toBe(2);
    expect(readFileSync(join(root, ORT, "package.json"), "utf8")).toBe(before);
  },
);

test("main は引数なしで postinstall を消して 0 を返す", () => {
  const { root } = bundle();
  expect(main([], root)).toBe(0);
  expect(readFileSync(join(root, ORT, "package.json"), "utf8")).not.toContain(
    "postinstall",
  );
});

test("main --check は問題の有無を 0 と 1 で返す", () => {
  const { root, fresh } = bundle();
  stripPostinstall(root);
  expect(main(["--check", root], fresh)).toBe(0);
  rmSync(join(root, binding("linux/x64")));
  expect(main(["--check", root], fresh)).toBe(1);
});
