// node bert-setup <重み> <cuda の 0 か 1>。tsunagari init が子プロセスで呼ぶ(fetch を proxy に通すため)
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./bert.ts";
import { fetchAssets } from "./bert-assets.ts";
import { libsOf, setupCuda } from "./bert-cuda.ts";
import type { Weights } from "./bert-files.ts";

const [weights, cuda] = process.argv.slice(2) as [Weights, string];

async function probe(dir: string): Promise<string | undefined> {
  const tmp = mkdtempSync(join(tmpdir(), "tsunagari-bert-"));
  try {
    const src = join(tmp, "in.json");
    const dst = join(tmp, "out.json");
    writeFileSync(src, JSON.stringify([["確かめの文です。", "次の文です。"]]));
    const { code, why } = await launch([weights, "cuda", src, dst, dir], dst, {
      LD_LIBRARY_PATH: libsOf(dir),
    });
    return code === 0 ? undefined : why;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  await fetchAssets(weights);
  if (cuda === "1") await setupCuda(probe);
} catch (e) {
  console.error(`bert-error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(3);
}
process.exit(0);
