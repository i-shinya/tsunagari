import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parse } from "./markdown.ts";
import { type Context, contextOf, requests } from "./providers.ts";

const bench = fileURLToPath(new URL("./bench.ts", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "tsunagari-bench-"));
const gold = join(home, "proto");
const out = join(gold, "gen", "out", "x");
mkdirSync(join(out, "verify"), { recursive: true });
const text = "あの文です。しかし、いの文です。うの文です。\n";
writeFileSync(join(gold, "gen", "gold.json"), "[]");
writeFileSync(join(out, "base.md"), text);
writeFileSync(join(out, "leap.md"), text);
writeFileSync(join(out, "result.json"), '{"edits":[]}');
const empty = join(home, "empty");
mkdirSync(join(empty, "gen", "out"), { recursive: true });
writeFileSync(join(empty, "gen", "gold.json"), "[]");

const { TYPESAFE_API_KEY: _1, ...rest } = process.env;
const env = { ...rest, HOME: home, USERPROFILE: home };
const run = (args: string[], extra = {}, dir = gold) =>
  spawnSync(process.execPath, [bench, "--gold-dir", dir, ...args], {
    env: { ...env, ...extra },
    encoding: "utf8",
  });

function writeCache(
  model: { default?: string; connectives?: string },
  ctx: Context = contextOf("full-once") as Context,
) {
  const doc = parse(text, false);
  const cache = Object.fromEntries(
    (["default", "connectives"] as const)
      .filter((mode) => model[mode])
      .flatMap((mode) =>
        requests(doc, "jev", mode, ctx)
          .flat()
          .map((r) => {
            const v = {
              model: model[mode],
              at: Date.now() - (mode === "default" ? 1000 : 0),
            };
            return [
              r.hash,
              r.q.type === "noul"
                ? { p: 0.5, ...v }
                : { probs: { 逆接: 0.5 }, ...v },
            ];
          }),
      ),
  );
  mkdirSync(join(home, ".cache", "tsunagari"), { recursive: true });
  writeFileSync(
    join(home, ".cache", "tsunagari", "answers.json"),
    JSON.stringify(cache),
  );
}

test.each([
  {
    args: ["--settings", "nope"],
    status: 2,
    stderr: "default:all, default:ctx2",
  },
  { args: [], status: 3, stderr: "TYPESAFE_API_KEY" },
  { args: ["--dry-run"], status: 0, stderr: "" },
])("bench $args で $status を返す", ({ args, status, stderr }) => {
  const r = run(args);
  expect(r.status).toBe(status);
  expect(r.stderr).toContain(stderr);
});

test("正解の文章が 1 本も無ければ 2 で終わる", () => {
  const r = run(["--dry-run"], {}, empty);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("正解の文章が無い");
});

test("見積もりは base と leap で同じ本文を 1 回だけ数える", () => {
  mkdirSync(join(home, ".cache", "tsunagari"), { recursive: true });
  writeFileSync(join(home, ".cache", "tsunagari", "answers.json"), "{}");
  expect(
    run(["--dry-run", "--settings", "default,connectives"]).stdout,
  ).toContain("送る 5 件");
});

test("取り置きが全部当たれば送らずに設定ごとの表を出す", () => {
  writeCache({ default: "v1", connectives: "v1" });
  const r = run(["--settings", "default,connectives"], {
    TYPESAFE_API_KEY: "k",
  });
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("送った 0 か所");
  expect(r.stderr).toContain("版 v1");
  expect(
    r.stdout.match(/^\| (default|connectives) \|.* \| \$\d+\.\d{4} \|$/gm),
  ).toHaveLength(12);
  expect(r.stdout).toContain(
    "| default | 接続詞:飛躍版(同じ語どうし) | すべて |",
  );
});

test("版がそろわず測り直す分が上限を超えれば、送らずに 3 で終わる", () => {
  writeCache({ default: "v1", connectives: "v2" });
  const r = run(
    ["--settings", "default,connectives", "--max-usd", "0.0000001"],
    { TYPESAFE_API_KEY: "k" },
  );
  expect(r.status).toBe(3);
  expect(r.stderr).toContain("上限を超える");
  expect(r.stdout).toBe("");
});

test("途中の答えで失敗すれば 3 で終わり、届いた答えは取り置きに残す", () => {
  writeCache({});
  const stub = join(home, "fail-stub.mjs");
  writeFileSync(
    stub,
    `let n = 0;
globalThis.fetch = async (url, init) => {
  if (n++ === 0) {
    const [id] = Object.keys(JSON.parse(init.body).questions);
    return Response.json({ model: "v1", answers: { [id]: { noul: 0.5 } } });
  }
  await new Promise((r) => setTimeout(r, 50));
  return new Response("bad", { status: 400 });
};`,
  );
  const r = spawnSync(
    process.execPath,
    ["--import", stub, bench, "--gold-dir", gold, "--settings", "default"],
    { env: { ...env, TYPESAFE_API_KEY: "k" }, encoding: "utf8" },
  );
  expect(r.status).toBe(3);
  const saved = readFileSync(
    join(home, ".cache", "tsunagari", "answers.json"),
    "utf8",
  );
  expect(Object.keys(JSON.parse(saved)).length).toBeGreaterThan(0);
});

test("範囲の付いた設定は、その範囲の本文の取り置きを使う", () => {
  writeCache({ default: "v1" }, contextOf("s1") as Context);
  const r = run(["--settings", "default:s1"], { TYPESAFE_API_KEY: "k" });
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("送った 0 か所");
  expect(r.stdout).toMatch(/^\| default:s1 \|/m);
});
