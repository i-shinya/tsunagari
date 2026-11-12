import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const stamp = fileURLToPath(new URL("./stamp.ts", import.meta.url));
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();

function pkgDir(parent: string) {
  const dir = join(parent, "pkg");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"version":"1.2.3"}');
  return dir;
}
function run(dir: string, path?: string) {
  const r = spawnSync(process.execPath, [stamp], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: path ?? process.env.PATH },
  });
  expect(r.status).toBe(0);
  return readFileSync(join(dir, "dist", "version.txt"), "utf8");
}

test("git のリポジトリでは、版にコミットを添えて dist に刻む", () => {
  const dir = pkgDir(mkdtempSync(join(tmpdir(), "tsunagari-stamp-")));
  git(dir, "init", "-q");
  git(dir, "commit", "-q", "--allow-empty", "-m", "x");
  expect(run(dir)).toBe(
    `1.2.3+${git(dir, "rev-parse", "--short=7", "HEAD")}\n`,
  );
});

test("git で管理された親の下でも、.git が無ければ親のコミットを刻まない", () => {
  const parent = mkdtempSync(join(tmpdir(), "tsunagari-stamp-"));
  git(parent, "init", "-q");
  git(parent, "commit", "-q", "--allow-empty", "-m", "x");
  expect(run(pkgDir(parent))).toBe("1.2.3+unknown\n");
});

test("git が無いときは落ちずに unknown を刻む", () => {
  const dir = pkgDir(mkdtempSync(join(tmpdir(), "tsunagari-stamp-")));
  mkdirSync(join(dir, ".git"));
  expect(run(dir, mkdtempSync(join(tmpdir(), "tsunagari-path-")))).toBe(
    "1.2.3+unknown\n",
  );
});
