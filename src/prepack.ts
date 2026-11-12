import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

type Deps = Record<string, string>;
type Pkg = {
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Deps;
  optionalDependencies?: Deps;
  peerDependencies?: Deps;
};
type Lock = {
  packages: Record<string, { version?: string; dependencies?: Deps }>;
};

const ORT = "node_modules/onnxruntime-node";
const ORT_TARGETS = [
  "win32/x64",
  "win32/arm64",
  "darwin/arm64",
  "linux/x64",
  "linux/arm64",
];
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];

const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, "utf8")) as T;

function providers(root: string): string[] {
  const bin = join(root, ORT, "bin");
  if (!existsSync(bin)) return [];
  return readdirSync(bin, { recursive: true, encoding: "utf8" }).filter((f) =>
    basename(f).startsWith("libonnxruntime_providers_"),
  );
}

/** 同梱する onnxruntime-node の postinstall を消す。NuGet の provider が残っていれば投げる。 */
export function stripPostinstall(root: string): void {
  if (providers(root).length > 0) {
    throw new Error(
      "NuGet の provider が node_modules に残っているので同梱できない。ONNXRUNTIME_NODE_INSTALL=skip で npm ci をやり直す",
    );
  }
  const file = join(root, ORT, "package.json");
  const pkg = readJson<Pkg>(file);
  delete pkg.scripts?.postinstall;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

function bundled(root: string, parent = ""): string[] {
  const nm = parent ? `${parent}/node_modules` : "node_modules";
  const abs = join(root, nm);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((e) => !e.startsWith("."))
    .flatMap((e) =>
      e.startsWith("@")
        ? readdirSync(join(abs, e)).map((s) => `${e}/${s}`)
        : [e],
    )
    .flatMap((n) => [`${nm}/${n}`, ...bundled(root, `${nm}/${n}`)]);
}

function resolves(root: string, from: string, dep: string): boolean {
  for (let at = from; ; ) {
    if (existsSync(join(root, at, "node_modules", dep))) return true;
    if (!at) return false;
    const i = at.lastIndexOf("/node_modules/");
    at = i < 0 ? "" : at.slice(0, i);
  }
}

const declared = (pkg: Pkg) =>
  Object.keys({
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  });

function withoutPostinstall(file: string): Pkg {
  const pkg = readJson<Pkg>(file);
  delete pkg.scripts?.postinstall;
  return pkg;
}

/** tarball の中のファイルのうち、npm ci の木と違うものを返す。許す差は onnxruntime-node の postinstall だけ。 */
function changedFiles(root: string, fresh: string, key: string): string[] {
  const dir = join(root, key);
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .filter((f) => !f.split(sep).includes("node_modules"))
    .filter((f) => {
      const a = join(dir, f);
      const b = join(fresh, key, f);
      if (!existsSync(b)) return true;
      if (key === ORT && f === "package.json") {
        return !isDeepStrictEqual(withoutPostinstall(a), withoutPostinstall(b));
      }
      return !readFileSync(a).equals(readFileSync(b));
    });
}

/** 展開した tarball を package-lock と npm ci の木に照らし、問題を文の配列で返す。 */
export function checkBundle(root: string, lock: Lock, fresh: string): string[] {
  const out: string[] = [];
  const check = (name: string, key: string, pkg: Pkg) => {
    for (const s of INSTALL_SCRIPTS) {
      if (pkg.scripts?.[s]) out.push(`${name}: ${s} が残っている`);
    }
    if (existsSync(join(root, key, "binding.gyp"))) {
      out.push(`${name}: binding.gyp がある`);
    }
  };
  const top = readJson<Pkg>(join(root, "package.json"));
  check("tsunagari", "", top);
  const runtime = new Set([
    ...declared(top),
    ...Object.keys(lock.packages[""]?.dependencies ?? {}),
  ]);
  for (const d of runtime) {
    if (!resolves(root, "", d)) out.push(`tsunagari: ${d} が同梱されていない`);
  }
  for (const key of bundled(root)) {
    const name = key.slice(key.lastIndexOf("node_modules/") + 13);
    const pkg = readJson<Pkg>(join(root, key, "package.json"));
    check(name, key, pkg);
    const locked = lock.packages[key]?.version;
    if (!locked || pkg.version !== locked) {
      out.push(`${name}: ${pkg.version} が lock の ${locked} と違う`);
    }
    for (const d of declared(pkg)) {
      if (!resolves(root, key, d)) out.push(`${name}: ${d} が同梱されていない`);
    }
    for (const f of changedFiles(root, fresh, key)) {
      out.push(`${name}: ${f} が npm ci の木と違う`);
    }
  }
  for (const t of ORT_TARGETS) {
    const file = join(
      root,
      ORT,
      "bin",
      "napi-v6",
      t,
      "onnxruntime_binding.node",
    );
    if (!existsSync(file)) out.push(`onnxruntime-node: ${t} のバイナリが無い`);
  }
  for (const p of providers(root))
    out.push(`NuGet の providers が混ざった: ${p}`);
  return out;
}

/** 引数なしで postinstall を消す。`--check <dir>` は cwd の lock と node_modules に照らす。戻り値は終わり方の番号。 */
export function main(args: string[], cwd: string): number {
  if (args.length === 0) {
    stripPostinstall(cwd);
    return 0;
  }
  if (args.length !== 2 || args[0] !== "--check" || !args[1]) {
    console.error("使い方: prepack [--check <展開した tarball>]");
    return 2;
  }
  const problems = checkBundle(
    args[1],
    readJson<Lock>(join(cwd, "package-lock.json")),
    cwd,
  );
  for (const p of problems) console.error(p);
  return problems.length > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
) {
  process.exitCode = main(process.argv.slice(2), process.cwd());
}
