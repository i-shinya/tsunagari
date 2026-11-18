import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cudaDir, cudaReady, hasNvidia, libsOf } from "./bert-cuda.ts";
import type { Weights } from "./bert-files.ts";
import type { Doc } from "./markdown.ts";

export type Backend = "dml" | "webgpu" | "cuda" | "cpu";
type Outcome = { code: number | null; why: string; out: unknown };

/** 隣のスクリプトのパス。import.meta.url が .ts なのは src から直接動かす開発の道具のとき */
export const sibling = (name: string) =>
  fileURLToPath(
    new URL(
      `./${name}${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`,
      import.meta.url,
    ),
  );

export function firstBackend(
  platform: NodeJS.Platform,
  cuda: boolean,
): Backend {
  if (platform === "win32") return "dml";
  if (platform === "darwin") return "webgpu";
  return platform === "linux" && cuda ? "cuda" : "cpu";
}

function valid(out: unknown, count: number): out is number[] {
  return (
    Array.isArray(out) &&
    out.length === count &&
    out.every((p) => typeof p === "number" && p >= 0 && p <= 1)
  );
}

/** first で動かし、GPU が失敗すれば CPU でやり直す。worker の終わり方 3 は振り替えない。docs/design/cli.md「BERT」参照 */
export async function judge(
  first: Backend,
  count: number,
  run: (b: Backend) => Promise<Outcome>,
): Promise<number[]> {
  for (let backend = first; ; backend = "cpu") {
    const { code, why, out } = await run(backend);
    if (code === 0 && valid(out, count)) {
      console.error(`bert: ${backend} で動いた`);
      return out;
    }
    const reason = code === 0 ? "答えの形が違う" : why;
    if (backend === "cpu" || code === 3) throw new Error(`bert: ${reason}`);
    console.error(`bert: GPU(${backend})で動かせない: ${reason}。CPU で動かす`);
  }
}

export function launch(
  args: string[],
  dst: string,
  env: NodeJS.ProcessEnv = {},
): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [sibling("bert-worker"), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env, NODE_USE_ENV_PROXY: "1" },
    });
    let tail = "";
    child.stdout.on("data", (c: Buffer) => process.stderr.write(c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => {
      process.stderr.write(c);
      tail = (tail + c).slice(-4096);
    });
    child.on("error", (e) =>
      resolve({ code: 1, why: e.message, out: undefined }),
    );
    child.on("close", (code, signal) => {
      const why =
        /bert-error: (.*)/.exec(tail)?.[1].slice(0, 300) ??
        `終わり方 ${code ?? signal}`;
      let out: unknown;
      try {
        out = JSON.parse(readFileSync(dst, "utf8"));
      } catch {}
      resolve({ code, why, out });
    });
  });
}

/** doc.boundaries と同じ順に、前の 2 文から後ろの文へつながる確率を返す。動かなければ `bert: <理由>` の Error を投げる */
export async function bertScores(
  doc: Doc,
  weights: Weights = "fp16",
): Promise<number[]> {
  const pairs = doc.boundaries.map((b) => [
    [b.before, b.prev].filter(Boolean).join(" "),
    b.next,
  ]);
  const dir = mkdtempSync(join(tmpdir(), "tsunagari-bert-"));
  try {
    const src = join(dir, "in.json");
    const dst = join(dir, "out.json");
    writeFileSync(src, JSON.stringify(pairs));
    const ready = cudaReady();
    if (
      process.platform === "linux" &&
      process.arch === "x64" &&
      !ready &&
      hasNvidia()
    )
      console.error("bert: GPU を使うには tsunagari init を実行してください");
    return await judge(
      firstBackend(process.platform, ready),
      pairs.length,
      (b) =>
        b === "cuda"
          ? launch([weights, b, src, dst, cudaDir()], dst, {
              LD_LIBRARY_PATH: libsOf(cudaDir()),
            })
          : launch([weights, b, src, dst], dst),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
