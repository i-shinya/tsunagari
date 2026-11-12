#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  type Article,
  classify,
  GOLD_SETS,
  type GoldEntry,
  type GoldSetName,
  SAME_HEAD,
  type Scored,
  SETTINGS,
  type Setting,
  type SettingName,
  summarize,
  type Votes,
} from "./accuracy.ts";
import { headWord } from "./connectives.ts";
import { type Doc, parse } from "./markdown.ts";
import {
  bill,
  type Cache,
  live,
  PROVIDERS,
  type ProviderName,
  readKeys,
  requests,
  score,
} from "./providers.ts";

const settingNames = Object.keys(SETTINGS);
const provider: ProviderName = "jev";
const setNames = Object.keys(GOLD_SETS) as GoldSetName[];
const usage = `Usage: node dist/bench.js [--settings ${settingNames.join(",")}] [--gold-dir <dir>] [--dry-run] [--max-usd <額>] | --help`;
const keyFile = join(homedir(), ".config", "tsunagari", "decision.env");
const cacheFile = join(homedir(), ".cache", "tsunagari", "answers.json");

function fail(code: 2 | 3, message: string): never {
  console.error(message);
  process.exit(code);
}

function args() {
  try {
    return parseArgs({
      options: {
        settings: { type: "string", default: settingNames.join(",") },
        "gold-dir": {
          type: "string",
          default: fileURLToPath(new URL("../proto/", import.meta.url)),
        },
        "dry-run": { type: "boolean", default: false },
        "max-usd": { type: "string", default: "2" },
        help: { type: "boolean", default: false },
      },
    }).values;
  } catch (e) {
    fail(2, `${(e as Error).message}\n${usage}`);
  }
}

function loadCache(): Cache {
  try {
    const c: unknown = JSON.parse(readFileSync(cacheFile, "utf8"));
    return c && typeof c === "object" && !Array.isArray(c) ? (c as Cache) : {};
  } catch {
    return {};
  }
}

// shortcut: 同時に走らせると後に書いた方が勝ち、先の答えの取り置きだけが消える
function saveCache(cache: Cache) {
  try {
    mkdirSync(dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, cacheFile);
  } catch (e) {
    console.error(`取り置きを書けない: ${(e as Error).message}`);
  }
}

const json = (...p: string[]) => JSON.parse(readFileSync(join(...p), "utf8"));

const answerFiles = (dir: string, suffix: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(`-${suffix}.json`))
    : [];

function votes(dir: string, suffix: string): Votes {
  const c: Votes = new Map();
  for (const f of answerFiles(dir, suffix))
    for (const s of json(dir, f).stops ?? [])
      c.set(Number(s.n), (c.get(Number(s.n)) ?? 0) + 1);
  return c;
}

function articles(root: string): Article[] {
  const gen = join(root, "gen");
  const gold: GoldEntry[] = json(gen, "gold.json");
  return readdirSync(join(gen, "out"))
    .sort()
    .map((id) => {
      const out = join(gen, "out", id);
      const r = json(out, "result.json");
      const c = join(root, "conn", "out", id);
      const cv = join(c, "verify");
      const connAnswers = answerFiles(cv, "conn").length;
      if (connAnswers === 1)
        console.error(`${id}: 接続詞版の答えが 1 つだけなので束に入れない`);
      return {
        id,
        genre: typeof r.genre === "string" ? r.genre : "種類なし",
        gold: gold.filter((g) => g.id === id),
        leapEdits: r.edits ?? [],
        base: votes(join(out, "verify"), "base"),
        leap: votes(join(out, "verify"), "leap"),
        conn:
          connAnswers > 1
            ? {
                n: connAnswers,
                edits: json(c, "edits.json").edits,
                votes: votes(cv, "conn"),
              }
            : undefined,
      };
    });
}

const values = args();
if (values.help) {
  console.log(usage);
  process.exit(0);
}
const settings = [
  ...new Set(
    values.settings
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
const badSetting = settings.find((s) => !Object.hasOwn(SETTINGS, s));
if (badSetting !== undefined || !settings.length)
  fail(
    2,
    `知らない設定: ${badSetting ?? ""}(使えるのは ${settingNames.join(", ")})`,
  );
const max = Number(values["max-usd"]);
if (!(Number.isFinite(max) && max > 0))
  fail(2, `--max-usd は正の数: ${values["max-usd"]}\n${usage}`);
const root = values["gold-dir"];

let arts: Article[] = [];
try {
  arts = articles(root);
} catch (e) {
  fail(2, `正解を読めない: ${root}(${(e as Error).message})`);
}
if (!arts.length) fail(2, `正解の文章が無い: ${join(root, "gen", "out")}`);

type Job = { name: SettingName; setting: Setting; doc: Doc; path: string };
type Labeled = { a: Article; path: string; groups: string[] };
type Req = ReturnType<typeof requests>[number][number];
const jobs = new Map<string, Job>();
const docs = new Map<string, Doc>();
const docOf = (path: string) => {
  let d = docs.get(path);
  if (!d) {
    d = parse(readFileSync(path, "utf8"), false);
    docs.set(path, d);
  }
  return d;
};
const jobKey = (s: SettingName, path: string) => `${s}\0${path}`;
const labeled = new Map<GoldSetName, Labeled[]>();
for (const set of setNames) {
  let unplaced = 0;
  labeled.set(
    set,
    arts.flatMap((a) => {
      const f = GOLD_SETS[set].file(a);
      if (!f) return [];
      const path = join(root, ...f);
      try {
        const c = classify(set, a, docOf(path));
        unplaced += c.unplaced;
        return [{ a, path, groups: c.groups }];
      } catch (e) {
        return fail(
          2,
          `正解を組めない: ${set} ${a.id}: ${(e as Error).message}`,
        );
      }
    }),
  );
  if (unplaced)
    console.error(
      `${set}: 境目の無い文に付いた正解と印 ${unplaced} 件は数えない`,
    );
}
for (const s of settings)
  for (const xs of labeled.values())
    for (const { path } of xs)
      jobs.set(jobKey(s, path), {
        name: s,
        setting: SETTINGS[s],
        doc: docOf(path),
        path,
      });
const articleCount = new Set([...labeled.values()].flat().map(({ a }) => a.id))
  .size;

const cache = loadCache();
const reqs = new Map<Job, Req[]>(
  [...jobs.values()].map((j) => [
    j,
    requests(j.doc, provider, j.setting.mode, j.setting.context).flat(),
  ]),
);
const bodies = [...reqs.values()].reduce((n, rs) => n + rs.length, 0);
// docs/design/bench.md「送り方と取り置き」参照
const unique = (rs: Req[]) => [...new Map(rs.map((r) => [r.hash, r])).values()];
function pending(js: Job[]) {
  const now = Date.now();
  const todo = js
    .flatMap((j) => reqs.get(j) ?? [])
    .filter((r) => !live(cache[r.hash], now, r.q.type));
  return bill(unique(todo), provider);
}
const {
  sent: toSend,
  calls: toCall,
  tokens,
  usd,
} = pending([...jobs.values()]);
const boundaries = [...jobs.values()].reduce(
  (n, j) => n + j.doc.boundaries.length,
  0,
);
const cost = `記事 ${articleCount} 本、境目 ${boundaries} か所、送る ${toSend} 件、約 ${tokens} トークン、$${usd.toFixed(4)}(上限 $${max})`;
if (values["dry-run"]) {
  console.log(`${provider}: ${usd > max ? `${cost}、上限を超える` : cost}`);
  if (toCall < toSend) console.error(`呼び出し ${toCall} 回にまとめる`);
  process.exit(0);
}

if (usd > max)
  fail(3, `${cost}。上限を超えるので送らない。上げるなら --max-usd`);
const keyNames = PROVIDERS[provider].keys;
const keys = readKeys(process.env, keyFile, keyNames);
const missing = keyNames.filter((k) => !keys[k]);
if (missing.length)
  fail(3, `鍵が無い。${missing.join(" と ")} を環境変数か ${keyFile} に置く`);

const t0 = Date.now();
const probs = new Map<string, number[]>();
const billed = new Map<SettingName, { calls: number; tokens: number }>();
let sent = 0;
const measure = async (todo: [string, Job][]) => {
  let i = 0;
  for (const [k, j] of todo) {
    console.error(`[${++i}/${todo.length}] ${j.name} ${j.path}`);
    const r = await score(
      j.doc,
      provider,
      keyNames.map((n) => keys[n] ?? ""),
      cache,
      j.setting.mode,
      j.setting.context,
    ).catch((e: Error) => e);
    if (r instanceof Error || r.sent) saveCache(cache);
    if (r instanceof Error) fail(3, r.message);
    probs.set(k, r.probs);
    sent += r.sent;
    const b = billed.get(j.name) ?? { calls: 0, tokens: 0 };
    billed.set(j.name, {
      calls: b.calls + r.calls,
      tokens: b.tokens + r.billed,
    });
  }
};
const answers = (j: Job) => (reqs.get(j) ?? []).map((r) => cache[r.hash]);
await measure([...jobs]);
const latest = [...jobs.values()]
  .flatMap(answers)
  .reduce<Cache[string] | undefined>(
    (a, b) => (b && (!a || b.at > a.at) ? b : a),
    undefined,
  )?.model;
const stale = [...jobs].filter(([, j]) =>
  answers(j).some((v) => v?.model !== latest),
);
for (const [, j] of stale)
  for (const r of reqs.get(j) ?? [])
    if (cache[r.hash]?.model !== latest) delete cache[r.hash];
if (stale.length) {
  const more = pending(stale.map(([, j]) => j));
  console.error(
    `版 ${latest} にそろえるため ${stale.length} 本を測り直す(送る ${more.sent} 件、$${more.usd.toFixed(4)})`,
  );
  if (usd + more.usd > max)
    fail(
      3,
      `測り直すと上限を超える(合わせて $${(usd + more.usd).toFixed(4)}、上限 $${max})。上げるなら --max-usd`,
    );
  await measure(stale);
}
const got = [...jobs.values()].flatMap(answers);
const versions = new Set(got.map((v) => v?.model));
if (versions.size > 1 || got.some((v) => !v))
  fail(3, `版がそろわない: ${[...versions].join(", ")}。回し直す`);
console.error(`測った側: ${provider}(版 ${[...versions][0]})`);
console.error(`送った ${sent} か所、取り置きを使った ${bodies - sent} か所`);
for (const [s, b] of billed)
  if (b.calls)
    console.error(
      `${s}: 呼び出し ${b.calls} 回、請求された入力 ${b.tokens} トークン`,
    );
console.error(`${((Date.now() - t0) / 1000).toFixed(1)} 秒`);

console.log(
  "| 設定 | 正解の束 | 種類 | 記事 | 正 | 負 | AUC | 幅 | 低い順 10% に入った正 | 低い順 5 件に入った正 | 額 |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const s of settings) {
  // docs/design/bench.md「表」参照
  const all = [...jobs.values()].filter((j) => j.name === s);
  const price = `$${bill(unique(all.flatMap((j) => reqs.get(j) ?? [])), provider).usd.toFixed(4)}`;
  for (const set of setNames) {
    const rows = (labeled.get(set) ?? []).flatMap(({ a, path, groups }) => {
      const ps = probs.get(jobKey(s, path)) ?? [];
      return groups.map((group, k) => ({
        id: a.id,
        genre: a.genre,
        p: ps[k],
        group,
        head: headWord(docOf(path).boundaries[k].next)?.word,
      }));
    });
    const genres = [...new Set(rows.map((r) => r.genre))].sort();
    const groups: [string, string, Scored[]][] = [[set, "すべて", rows]];
    if (genres.length > 1)
      for (const g of genres)
        groups.push([set, g, rows.filter((r) => r.genre === g)]);
    if (set.startsWith("接続詞"))
      groups.push([`${set}${SAME_HEAD}`, "すべて", rows]);
    for (const [name, g, xs] of groups) {
      const m = summarize(xs, name.endsWith(SAME_HEAD));
      console.log(
        `| ${s} | ${name} | ${g} | ${m.articles} | ${m.pos} | ${m.neg} | ${m.auc} | ${m.width} | ${m.top10} | ${m.top5} | ${price} |`,
      );
    }
  }
}
