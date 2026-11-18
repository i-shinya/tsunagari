import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { parse } from "./markdown.ts";
import {
  type Cache,
  contextOf,
  estimate,
  MODE_NAMES,
  readKeys,
  score,
} from "./providers.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const dir = mkdtempSync(join(tmpdir(), "tsunagari-"));
const file = join(dir, "decision.env");
writeFileSync(file, "OTHER=x\r\nexport TYPESAFE_API_KEY='from-file'\nEMPTY=\n");

test.each([
  {
    name: "環境変数が先",
    env: { TYPESAFE_API_KEY: "from-env" },
    file,
    want: { TYPESAFE_API_KEY: "from-env", EMPTY: undefined },
  },
  {
    name: "無ければファイルから、空は undefined",
    env: {},
    file,
    want: { TYPESAFE_API_KEY: "from-file", EMPTY: undefined },
  },
  {
    name: "どちらも無ければ undefined",
    env: {},
    file: join(dir, "none"),
    want: { TYPESAFE_API_KEY: undefined, EMPTY: undefined },
  },
])("readKeys: $name", ({ env, file, want }) => {
  expect(readKeys(env, file, ["TYPESAFE_API_KEY", "EMPTY"])).toEqual(want);
});

const doc = parse("一つ目の文です。二つ目の文です。三つ目の文です。", false);
const p = (init: RequestInit) =>
  JSON.parse(String(init.body)).state.対象の文 === "二つ目の文です。"
    ? 0.9
    : 0.2;

test("score は jev の答えを境目の順に読み、送り先は api.typesafe.ai に固定", async () => {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      urls.push(new URL(url));
      return Response.json({ answers: { follows: { noul: p(init) } } });
    }),
  );
  expect((await score(doc, "jev", ["k"])).probs).toEqual([0.9, 0.2]);
  for (const u of urls) expect(u.host).toBe("api.typesafe.ai");
});

function stub(model = "jev-x") {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    Response.json({ model, answers: { follows: { noul: p(init) } } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test("score は同じ cache での 2 回目は何も送らない", async () => {
  const fetch = stub();
  const cache: Cache = {};
  expect(await score(doc, "jev", ["k"], cache)).toEqual({
    probs: [0.9, 0.2],
    sent: 2,
    calls: 2,
    billed: 0,
  });
  expect(await score(doc, "jev", ["k"], cache)).toEqual({
    probs: [0.9, 0.2],
    sent: 0,
    calls: 0,
    billed: 0,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("score は最後の文だけ変えると、その境目だけ送り直す", async () => {
  const cache: Cache = {};
  stub();
  await score(doc, "jev", ["k"], cache);
  const fetch = stub();
  const changed = parse(
    "一つ目の文です。二つ目の文です。三つ目を変えた。",
    false,
  );
  expect((await score(changed, "jev", ["k"], cache)).sent).toBe(1);
  expect(JSON.parse(String(fetch.mock.calls[0][1].body)).state.対象の文).toBe(
    "三つ目を変えた。",
  );
});

// 版の比べ合わせは何か送ったときだけなので、2 つ目の取り置きを消して送らせる
test.each([
  { name: "30 日より古い", entry: { at: 0 }, drop: false, sent: 1 },
  {
    name: "新しい答えと版が違う",
    entry: { model: "jev-old" },
    drop: true,
    sent: 2,
  },
])("score は取り置きが$nameと送り直す", async ({ entry, drop, sent }) => {
  const cache: Cache = {};
  stub();
  await score(doc, "jev", ["k"], cache);
  const [first, second] = Object.keys(cache);
  cache[first] = { ...cache[first], ...entry };
  if (drop) delete cache[second];
  stub();
  expect((await score(doc, "jev", ["k"], cache)).sent).toBe(sent);
  expect(Object.values(cache).map((v) => v.model)).toEqual(["jev-x", "jev-x"]);
});

test("score は再試行しない HTTP の失敗で、名前を頭に付け、鍵を含まない理由で落ちる", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("bad token sk-secret", { status: 401 })),
  );
  const err = await score(doc, "jev", ["sk-secret"]).catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toMatch(/^jev: HTTP 401/);
  expect((err as Error).message).not.toMatch(/sk-secret/);
});

test("score は答えの無い 200(拒否)を失敗にする", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ answers: { follows: { type: "refusal" } } }),
    ),
  );
  await expect(score(doc, "jev", ["k"])).rejects.toThrow(
    /^jev: HTTP 200 答えが無い\(refusal\)/,
  );
});

test("score は 200 の本文が null だと答えが無い失敗にする", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("null")),
  );
  await expect(score(doc, "jev", ["k"])).rejects.toThrow(
    /^jev: HTTP 200 答えが無い\(answers が空\)/,
  );
});

const changed = "一つ目の文です。二つ目の文です。三つ目を変えた。";
test.each([
  {
    name: "、取り置きが無いと全部を数える",
    fill: false,
    text: changed,
    age: 0,
    sent: 2,
  },
  {
    name: "、最後の文だけ変えるとその境目だけ数える",
    fill: true,
    text: changed,
    age: 0,
    sent: 1,
  },
  {
    name: "、同じ記事なら何も数えない",
    fill: true,
    text: "一つ目の文です。二つ目の文です。三つ目の文です。",
    age: 0,
    sent: 0,
  },
  {
    name: "、30 日より古い取り置きを当たりに数えない",
    fill: true,
    text: "一つ目の文です。二つ目の文です。三つ目の文です。",
    age: 31 * 24 * 60 * 60 * 1000,
    sent: 2,
  },
])("estimate は$name", async ({ fill, text, age, sent }) => {
  const cache: Cache = {};
  if (fill) {
    stub();
    await score(doc, "jev", ["k"], cache);
    for (const v of Object.values(cache)) v.at -= age;
  }
  const target = parse(text, false);
  const full = estimate(target, "jev");
  const e = estimate(target, "jev", cache);
  expect(e.sent).toBe(sent);
  if (sent === 2) expect(e).toEqual(full);
  else expect(e.usd).toBeLessThan(full.usd);
  expect(e.tokens > 0 && e.usd > 0).toBe(sent > 0);
});

test("score は既定で jev に今までと同じ本文を送る", async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return Response.json({ answers: { follows: { noul: 0.5 } } });
    }),
  );
  await score(doc, "jev", ["k"], {}, "default", undefined, 1);
  expect(createHash("sha256").update(bodies.join("\n")).digest("hex")).toBe(
    "057018286b348d5bc6acc6fc4107f16db3dfea4073f40d6e616db239c5cf2cbf",
  );
});

const conn = parse("雨が降った。ただ、試合はあった。観客も多かった。", false);
const PICKS = { 逆接: 0.25, 補足: 0.125, 因果: 0.625 };
const asked = (init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const ctx: string = body.state.文脈;
  return {
    choice: "逆接" in body.questions.q.criteria,
    p: ctx.includes("【対象】観客") ? 0.6 : 0.8,
  };
};

test("score は接続詞のモードで jev に、接続詞のある境目は 2 つの問いの低い方を、無い境目は 1 つ目の問いを返す", async () => {
  connStub();
  expect(await score(conn, "jev", ["k"], {}, "connectives-choice")).toEqual({
    probs: [0.375, 0.6],
    sent: 3,
    calls: 3,
    billed: 0,
  });
});

function connStub() {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const a = asked(init);
    return Response.json({
      model: "jev-x",
      answers: { q: a.choice ? { probabilities: PICKS } : { noul: a.p } },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test("score は接続詞だけを書き換えると、伏せた問いは送り直さず、書いた関係の確率を取り置きから読み直す", async () => {
  const cache: Cache = {};
  connStub();
  await score(conn, "jev", ["k"], cache, "connectives-choice");
  const fetch = connStub();
  const edited = parse(
    "雨が降った。だから、試合はあった。観客も多かった。",
    false,
  );
  expect(
    await score(edited, "jev", ["k"], cache, "connectives-choice"),
  ).toEqual({
    probs: [0.625, 0.6],
    sent: 2,
    calls: 2,
    billed: 0,
  });
  expect(fetch.mock.calls.map((c) => asked(c[1]).choice)).toEqual([
    false,
    false,
  ]);
});

test("score は形の合わない取り置きを当たりにせず送り直す", async () => {
  const cache: Cache = {};
  connStub();
  await score(conn, "jev", ["k"], cache, "connectives-choice");
  for (const [k, v] of Object.entries(cache))
    if ("probs" in v) cache[k] = { p: 0.5, model: v.model, at: v.at };
  connStub();
  expect(await score(conn, "jev", ["k"], cache, "connectives-choice")).toEqual({
    probs: [0.375, 0.6],
    sent: 1,
    calls: 1,
    billed: 0,
  });
});

test("estimate は接続詞のモードで送る本文を数える", async () => {
  const cache: Cache = {};
  expect(estimate(conn, "jev", cache, "connectives-choice").sent).toBe(3);
  connStub();
  await score(conn, "jev", ["k"], cache, "connectives-choice");
  expect(estimate(conn, "jev", cache, "connectives-choice")).toEqual({
    tokens: 0,
    usd: 0,
    sent: 0,
    calls: 0,
    bodies: 3,
  });
});

function relStub() {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const q: { type: string; instructions: string } = body.questions.q;
    const rel = q.instructions.includes("この言葉は");
    const p = body.state.文脈.includes("【対象】観客") ? 0.6 : rel ? 0.3 : 0.8;
    return Response.json({ model: "jev-x", answers: { q: { noul: p } } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test("score は接続詞のモードで、接続詞のある境目の 2 つ目を選ばせずに聞き、2 つの低い方を返す", async () => {
  const fetch = relStub();
  expect(await score(conn, "jev", ["k"], {}, "connectives")).toEqual({
    probs: [0.3, 0.6],
    sent: 3,
    calls: 3,
    billed: 0,
  });
  const qs = fetch.mock.calls.map(
    ([, init]) =>
      JSON.parse(String(init.body)).questions.q as {
        type: string;
        instructions: string;
      },
  );
  expect(qs.every((q) => q.type === "noul")).toBe(true);
  const rel = qs.filter((q) => q.instructions.includes("この言葉は"));
  expect(rel).toHaveLength(1);
  expect(rel[0].instructions).toContain("〔 〕には「ただ」が入る");
  expect(rel[0].instructions).toContain("逆接または補足");
});

test.each([
  { name: "拒否", choice: { type: "refusal" }, why: "refusal" },
  { name: "確率が無い", choice: { type: "choice" }, why: "choice" },
])(
  "score は選ばせる問いの答えが $name だと失敗にする",
  async ({ choice, why }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        Response.json({
          answers: { q: asked(init).choice ? choice : { noul: 0.5 } },
        }),
      ),
    );
    await expect(
      score(conn, "jev", ["k"], {}, "connectives-choice"),
    ).rejects.toThrow(`jev: HTTP 200 答えが無い(${why})`);
  },
);

const pinDoc = parse(
  "前置きの文です。\n\n## 一つ目\n\n一つ目の文です。二つ目の文です。\n\n- 項目の文です。\n\n## 二つ目\n\nあの文です。しかし、いの文です。\n",
  false,
);
async function sentBodies(run: () => Promise<unknown>) {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      const qs: Record<string, { criteria: object }> = JSON.parse(
        String(init.body),
      ).questions;
      const answers = Object.fromEntries(
        Object.entries(qs).map(([k, q]) => [
          k,
          {
            noul: 0.5,
            probabilities: Object.fromEntries(
              Object.keys(q.criteria).map((v) => [v, 0.1]),
            ),
          },
        ]),
      );
      return Response.json({ answers });
    }),
  );
  await run();
  return bodies;
}

const OLD = MODE_NAMES.flatMap((mode) =>
  "all ctx2 s1 s1-ba s2 s2-ba s3 s3-ba s5 s5-ba para para-ba sec sec-ba sec2 sec2-ba"
    .split(" ")
    .filter((r) => mode === "default" || r !== "ctx2")
    .map((r) => [`${mode}:${r}`, mode, contextOf(r)] as const),
);
test("score は範囲の付いた 46 の設定のどれでも、jev に固定した本文を送る", async () => {
  expect(OLD).toHaveLength(46);
  const all: string[] = [];
  for (const [s, mode, context] of OLD) {
    const bodies = await sentBodies(() =>
      score(pinDoc, "jev", ["k"], {}, mode, context),
    );
    all.push(s, ...bodies.sort());
  }
  expect(createHash("sha256").update(all.join("\n")).digest("hex")).toBe(
    "74751d3d4a5948c3b186659ec4c32210ddb08056aba176f976bef55f319fa012",
  );
});

test.each([
  ["all", { by: "all" }],
  ["ctx2", { by: "ctx2" }],
  ["s12-ba", { by: "sents", n: 12, after: true }],
  ["para", { by: "para", after: false }],
  ["sec-ba", { by: "sec", n: 1, after: true }],
  ["sec2", { by: "sec", n: 2, after: false }],
  ["s0", undefined],
  ["x", undefined],
  ["all-ba", undefined],
  ["ctx2-ba", undefined],
  ["full-once", { by: "full", explain: "once" }],
  ["full-each", { by: "full", explain: "each" }],
  ["full-once-ba", undefined],
])("contextOf は %s を %o に読む", (name, want) => {
  expect(contextOf(name)).toEqual(want);
});

test("score は ctx2 で、見出しと前の 2 文と後ろの文を送る", async () => {
  const [body] = await sentBodies(() =>
    score(doc, "jev", ["k"], {}, "default", { by: "ctx2" }, 1),
  );
  expect(JSON.parse(body).state).toEqual({
    見出し: "",
    前の前の文: "",
    前の文: "一つ目の文です。",
    後ろの文: "二つ目の文です。",
  });
});

const ONCE = { by: "full", explain: "once" } as const;
const EACH = { by: "full", explain: "each" } as const;
// 問いの名前 s<文の位置> から答えを作り、usage は 1 回 7 トークン。skip の名前には答えない
function byId(skip = "") {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      const qs: Record<string, { criteria: object }> = JSON.parse(
        String(init.body),
      ).questions;
      const answers = Object.fromEntries(
        Object.entries(qs)
          .filter(([id]) => id !== skip)
          .map(([id, q]) => [
            id,
            "逆接" in q.criteria
              ? { probabilities: PICKS }
              : { noul: id === "q" ? 0.6 : Number(id.slice(1)) / 1000 },
          ]),
      );
      return Response.json({ answers, usage: { input_tokens: 7 } });
    }),
  );
  return bodies;
}

const long = parse(
  Array.from({ length: 200 }, (_, i) => `文その${i}です。`).join(""),
  false,
);
test.each([
  { name: "jev の full-once", doc: pinDoc, ctx: ONCE, calls: 1 },
  { name: "jev の full-each", doc: pinDoc, ctx: EACH, calls: 1 },
  { name: "6 万字を超える jev", doc: long, ctx: EACH, calls: 2 },
] as const)(
  "score は $name で $calls 回に分けて全部の境目を聞き、答えを名前で読む",
  async ({ doc, ctx, calls }) => {
    const bodies = byId();
    const at = doc.boundaries.map((b) => b.at);
    expect(await score(doc, "jev", ["k"], {}, "default", ctx)).toEqual({
      probs: at.map((n) => n / 1000),
      sent: at.length,
      calls,
      billed: 7 * calls,
    });
    expect(estimate(doc, "jev", {}, "default", ctx).calls).toBe(calls);
    for (const b of bodies) expect(b.length).toBeLessThanOrEqual(60_000);
  },
);

test("score は答えの欠けた呼び出しで、届いた答えだけを取り置いてから落ちる", async () => {
  byId(`s${pinDoc.boundaries[0].at}`);
  const cache: Cache = {};
  await expect(
    score(pinDoc, "jev", ["k"], cache, "default", ONCE),
  ).rejects.toThrow(/^jev: HTTP 200 答えが無い\(answers が空\)/);
  expect(Object.keys(cache)).toHaveLength(pinDoc.boundaries.length - 1);
});

test("score は接続詞の full-once で、伏せた問いに s1 と同じ取り置きを使い、つなぐ言葉の問いだけを 1 回で送る", async () => {
  const two = parse("朝だった。雨が降った。ただ、試合はあった。", false);
  const cache: Cache = {};
  byId();
  await score(two, "jev", ["k"], cache, "connectives", contextOf("s1"));
  const bodies = byId();
  expect(await score(two, "jev", ["k"], cache, "connectives", ONCE)).toEqual({
    probs: [0.001, 0.002],
    sent: 2,
    calls: 1,
    billed: 7,
  });
  expect(Object.keys(JSON.parse(bodies[0]).questions)).toEqual(["s1", "s2"]);
});

const one = parse("一つ目の文です。二つ目の文です。", false);
const LONG = "TypeSafe-Danger-Zone-Long-Context";
const tooLong = () =>
  Response.json(
    { detail: { error_type: "max_tokens_exceeded" } },
    { status: 400 },
  );
const ok = () => Response.json({ answers: { follows: { noul: 0.9 } } });
function seq(...replies: (() => Response)[]) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    (replies.shift() ?? tooLong)(),
  );
  vi.stubGlobal("fetch", fetch);
  const long = () =>
    fetch.mock.calls.map(([, init]) => new Headers(init.headers).get(LONG));
  return { fetch, long };
}

test("score は jev の max_tokens_exceeded の 400 で、長い文脈の印を付けて同じ本文を待たずに 1 回だけ送り直す", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const { fetch, long } = seq(tooLong, ok);
  expect((await score(one, "jev", ["k"])).probs).toEqual([0.9]);
  expect(long()).toEqual([null, "true"]);
  const [a, b] = fetch.mock.calls;
  expect(b[0]).toBe(a[0]);
  expect(b[1].body).toBe(a[1].body);
});

test("score は jev で max_tokens_exceeded の 400 が続くと、2 回送って HTTP 400 で落ちる", async () => {
  const { long } = seq(tooLong);
  await expect(score(one, "jev", ["k"])).rejects.toThrow(/^jev: HTTP 400/);
  expect(long()).toEqual([null, "true"]);
});

test("score は 529 を待って送り直す", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const { fetch } = seq(
    () => new Response("system_overloaded", { status: 529 }),
    ok,
  );
  const [r] = await Promise.all([
    score(one, "jev", ["k"]),
    vi.advanceTimersByTimeAsync(1000),
  ]);
  expect(r.probs).toEqual([0.9]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("score は本文に insufficient_quota のある 429 で、送り直さず HTTP 429 で落ちる", async () => {
  const { fetch } = seq(() =>
    Response.json({ error: { code: "insufficient_quota" } }, { status: 429 }),
  );
  await expect(score(one, "jev", ["k"])).rejects.toThrow(/^jev: HTTP 429/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
