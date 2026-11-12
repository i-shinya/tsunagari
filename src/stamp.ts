import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function commit(): string {
  // .git が無い所で呼ぶと、親のリポジトリのコミットを返す
  if (!existsSync(".git")) return "unknown";
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};
writeFileSync(join("dist", "version.txt"), `${version}+${commit()}\n`);
