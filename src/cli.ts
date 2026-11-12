#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { bertScores } from "./bert.ts";
import { spearman } from "./compare.ts";
import { describe, lowest, NO_CUT, readCut } from "./cut.ts";
import { renderHtml } from "./html.ts";
import { parse } from "./markdown.ts";
import {
  type Cache,
  CONTEXTS,
  contextOf,
  estimate,
  PROVIDERS,
  type ProviderName,
  readKeys,
  score,
} from "./providers.ts";

type Scorer = "bert" | ProviderName;
const names: Scorer[] = ["bert", ...(Object.keys(PROVIDERS) as ProviderName[])];
const usage = `Usage: tsunagari <file.md> [--include-lists] [--connectives] [--connectives-choice] [--provider ${names.join(",")}] [--bert-weights fp16|q8] [--context <範囲>] [--dry-run] [--max-usd <額>] [--html <out.html>] | init [--accept-nvidia-eula] | --version | --help`;
const keyFile = join(homedir(), ".config", "tsunagari", "decision.env");
const settingsFile = join(homedir(), ".config", "tsunagari", "settings.env");
const cacheFile = join(homedir(), ".cache", "tsunagari", "answers.json");

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

function version(): string {
  try {
    return readFileSync(
      new URL("./version.txt", import.meta.url),
      "utf8",
    ).trim();
  } catch {
    return pkg.version;
  }
}

function fail(code: 2 | 3, message: string): never {
  console.error(message);
  process.exit(code);
}

function args() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        "include-lists": { type: "boolean", default: false },
        connectives: { type: "boolean", default: false },
        "connectives-choice": { type: "boolean", default: false },
        provider: { type: "string" },
        "bert-weights": { type: "string" },
        "accept-nvidia-eula": { type: "boolean", default: false },
        context: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        "max-usd": { type: "string", default: "0.5" },
        html: { type: "string" },
        help: { type: "boolean", default: false },
        version: { type: "boolean", default: false },
      },
    });
  } catch (e) {
    fail(2, `${(e as Error).message}\n${usage}`);
  }
}

function scorers(arg: string): Scorer[] {
  const list = [
    ...new Set(
      arg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  const bad = list.find((x) => !names.includes(x as Scorer));
  if (bad !== undefined || !list.length)
    fail(2, `知らない provider: ${bad ?? ""}(使えるのは ${names.join(", ")})`);
  return list as Scorer[];
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

const { values, positionals } = args();

if (positionals[0] === "init" || values["accept-nvidia-eula"]) {
  if (
    positionals[0] !== "init" ||
    positionals.length !== 1 ||
    process.argv
      .slice(2)
      .some((a) => !["init", "--accept-nvidia-eula"].includes(a))
  )
    fail(2, usage);
  const { runInit } = await import("./init.ts");
  process.exit(await runInit(values["accept-nvidia-eula"], keyFile));
}

if (values.version) {
  console.log(version());
} else if (values.help || positionals.length === 0) {
  console.log(usage);
} else {
  if (positionals.length > 1) fail(2, usage);
  if (values.connectives && values["connectives-choice"])
    fail(2, "--connectives と --connectives-choice は同時に使えない");
  const flag = values["connectives-choice"]
    ? "--connectives-choice"
    : values.connectives
      ? "--connectives"
      : "";
  const chosen = scorers(values.provider ?? (flag ? "jev" : "bert"));
  if (flag && chosen.includes("bert"))
    fail(2, `bert は ${flag} を聞けない。--provider jev を付ける`);
  if (values.context !== undefined && chosen.every((p) => p === "bert"))
    fail(2, "bert は前の 2 文で聞くので --context を使わない");
  const weights = values["bert-weights"] ?? "fp16";
  if (weights !== "fp16" && weights !== "q8")
    fail(2, `--bert-weights は fp16 か q8: ${weights}`);
  if (values["bert-weights"] !== undefined && !chosen.includes("bert"))
    fail(2, "--bert-weights は bert を選んだときだけ使う");
  const context = values.context ?? "full-once";
  const ctx = contextOf(context);
  if (!ctx || (ctx.by === "ctx2" && flag))
    fail(
      2,
      `${ctx ? `${flag} では使えない範囲` : "知らない範囲"}: ${context}(使えるのは ${flag ? CONTEXTS.replace("ctx2, ", "") : CONTEXTS})`,
    );
  const max = Number(values["max-usd"]);
  if (!(Number.isFinite(max) && max > 0))
    fail(2, `--max-usd は正の数: ${values["max-usd"]}\n${usage}`);
  const cut = readCut(process.env, settingsFile);
  if (typeof cut === "string") fail(2, cut);
  const file = positionals[0];
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail(2, `読めない: ${file}`);
  }
  const doc = parse(text, values["include-lists"]);
  if (!doc.boundaries.length) fail(3, "見る境目が無い");
  const mode = values["connectives-choice"]
    ? "connectives-choice"
    : values.connectives
      ? "connectives"
      : "default";
  const cache = loadCache();
  const count = doc.boundaries.length;
  const ests = chosen.map((p) =>
    p === "bert"
      ? { tokens: 0, usd: 0, sent: count, calls: 1, bodies: count }
      : estimate(doc, p, cache, mode, ctx),
  );
  const tokens = ests.reduce((n, e) => n + e.tokens, 0);
  const usd = ests.reduce((n, e) => n + e.usd, 0);
  const toSend = ests.reduce((n, e) => n + e.sent, 0);
  const calls = ests.reduce((n, e) => n + e.calls, 0);
  const cost = `境目 ${doc.boundaries.length} か所、送る ${toSend} 件、約 ${tokens} トークン、$${usd.toFixed(4)}(上限 $${max})`;
  if (values["dry-run"]) {
    console.log(
      JSON.stringify({
        version: version(),
        providers: chosen,
        estimate: {
          boundaries: count,
          send: toSend,
          tokens,
          usd,
          maxUsd: max,
          overBudget: usd > max,
        },
      }),
    );
    if (calls < toSend) console.error(`呼び出し ${calls} 回にまとめる`);
    process.exit(0);
  }
  if (usd > max)
    fail(3, `${cost}。上限を超えるので送らない。上げるなら --max-usd`);
  const keyNames = chosen.flatMap((p) =>
    p === "bert" ? [] : PROVIDERS[p].keys,
  );
  const keys = keyNames.length ? readKeys(process.env, keyFile, keyNames) : {};
  const missing = keyNames.filter((k) => !keys[k]);
  if (missing.length)
    fail(3, `鍵が無い。${missing.join(" と ")} を環境変数か ${keyFile} に置く`);
  console.error(`境目 ${count} か所を測る(${chosen.join(", ")})`);
  const t0 = Date.now();
  const r = await Promise.all(
    chosen.map((p) =>
      p === "bert"
        ? bertScores(doc, weights).then((probs) => ({
            probs,
            sent: count,
            calls: 1,
            billed: 0,
          }))
        : score(
            doc,
            p,
            PROVIDERS[p].keys.map((k) => keys[k] ?? ""),
            cache,
            mode,
            ctx,
          ),
    ),
  ).catch((e: Error) => e);
  saveCache(cache);
  if (r instanceof Error) fail(3, r.message);
  const probs = r.map((x) => x.probs);
  const sent = r.reduce((n, x) => n + x.sent, 0);
  const bodies = ests.reduce((n, e) => n + e.bodies, 0);
  console.error(`送った ${sent} か所、取り置きを使った ${bodies - sent} か所`);
  console.error(
    `呼び出し ${r.reduce((n, x) => n + x.calls, 0)} 回、請求された入力 ${r.reduce((n, x) => n + x.billed, 0)} トークン`,
  );
  console.error(`${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  const rows = doc.boundaries.map((b, i) => ({
    ...b,
    p: probs[0][i],
    ps: probs.map((ps) => ps[i]),
  }));
  const shown = lowest(rows, cut);
  if (cut !== NO_CUT)
    console.error(
      `足切り: ${describe(cut)}(境目 ${rows.length} か所のうち ${shown.length} か所)`,
    );
  if (values.html) {
    try {
      writeFileSync(values.html, renderHtml(file, text, rows, cut, chosen[0]));
    } catch {
      fail(2, `書けない: ${values.html}`);
    }
    console.error(`HTML: ${values.html}`);
  }
  const round = (x: number) => Number(x.toFixed(2));
  const correlations = chosen.flatMap((a, i) =>
    chosen.slice(i + 1).map((b, k) => {
      const rho = spearman(probs[i], probs[i + 1 + k]);
      return { a, b, rho: rho === null ? null : round(rho) };
    }),
  );
  console.log(
    JSON.stringify({
      version: version(),
      providers: chosen,
      boundaries: shown.map((r) => ({
        line: r.line,
        scores: Object.fromEntries(chosen.map((p, j) => [p, round(r.ps[j])])),
        prev: r.prev,
        next: r.next,
      })),
      correlations,
    }),
  );
}
