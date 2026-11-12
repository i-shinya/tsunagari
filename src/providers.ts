import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { headWord, REL } from "./connectives.ts";
import {
  type Boundary,
  context,
  type Doc,
  numbered,
  type Range,
} from "./markdown.ts";

const RETRY = [429, 500, 502, 503, 504, 529];
const TTL = 30 * 24 * 60 * 60 * 1000;
const FLOAT_BEFORE =
  "「文脈」は記事の一部で、対象の文を【対象】と【/対象】で囲んである。文脈には対象の文とその前だけを渡す。" +
  "読み手は記事を頭から順に読み、まだ後ろを読んでいない。対象の文より前に書かれたことだけで、読み手がこの文を補わずに分かるなら yes。" +
  "前に説明の無い言葉・もの・話がいきなり出る、指すものが前に無い、間の一歩が抜けている、つなぎの言葉が前とかみ合わないなら no。";
const FLOAT_BOTH =
  "「文脈」は記事の一部で、対象の文を【対象】と【/対象】で囲んである。文脈には対象の文の前と後ろを渡す。" +
  "読み手は記事を頭から順に読む。対象の文に来た読み手が、引っかからずに読み進められるなら yes。話題を切り出す文や前置きで、すぐ後ろで説明されるものも yes。" +
  "前にもすぐ後ろにも説明の無い言葉・もの・話が出る、指すものが無い、間の一歩が抜けている、つなぎの言葉が前とかみ合わないなら no。";
const CTX2 =
  "「後ろの文」は、その前の 2 文(「前の前の文」「前の文」)から話が自然につながっているか。" +
  "前の 2 文を読んだ人が、後ろの文が何の話をしているかを補わずに分かるなら yes。" +
  "話題が説明なしに飛ぶ、指すものが前に無い、間の一歩が抜けているなら no。";
const CTX2_CRITERIA = {
  true: "前の文の続きとして、そのまま読める",
  false: "前の文との間に飛躍があり、読み手が補う必要がある",
};
const FLOAT_CRITERIA = {
  true: "読み手は引っかからずに、そのまま分かる",
  false:
    "前提の無い言葉や話、指すもの、間の一歩が欠けていて、読み手が引っかかる",
};
const fitOf = (s: string) =>
  `${s}の頭の接続詞と、${s}の中で前半と後半をつなぐ言葉(〜ので・〜ため・〜から・〜が・〜けれど・〜のに・〜ても など)を見る。` +
  "どのつなぐ言葉も、それがつなぐ前後の論理の関係(理由と結果、逆のこと、言い換え、並べる、比べる、例、補足など)に合っているなら yes。つなぐ言葉が無ければ yes。" +
  "どれか 1 つでも、関係の向きや種類が合わない(理由でないのに「ので」、逆でないのに「のに」「が」「しかし」、言い換えていないのに「つまり」など)なら no。";
const FIT_ANY = `「文脈」は記事の一部で、対象の文を【対象】と【/対象】で囲んである。${fitOf("対象の文")}`;
const NUMBERED =
  "「本文」は記事の全文で、文ごとに頭に [番号] を付けてある。問いは 1 つの文を番号で指す。";
const FLOAT_FULL = `${NUMBERED}読み手は記事を頭から順に読み、指した文に来た時点ではまだその後ろを読んでいない。指した文より前に書かれたことだけで、読み手がこの文を補わずに分かるなら yes。前に説明の無い言葉・もの・話がいきなり出る、指すものが前に無い、間の一歩が抜けている、つなぎの言葉が前とかみ合わないなら no。指した文より後ろに書かれたことは判断に使わない。`;
const FIT_FULL = NUMBERED + fitOf("指した文");
const FIT_ANY_C = {
  true: "つなぐ言葉が、どれも前後の関係に合っている",
  false: "前後の関係に合わないつなぐ言葉がある",
};
const MASK =
  "「文脈」は記事の一部で、対象の文を【対象】と【/対象】で囲んである。対象の文の頭の〔 〕には、前に書かれたことと対象の文をつなぐ接続詞が入る。" +
  "前に書かれたことと対象の文の論理の関係として、最も合うものを選ぶ。";
const REL_ASK = (word: string, rels: readonly string[]) =>
  "「文脈」は記事の一部で、対象の文を【対象】と【/対象】で囲んである。" +
  `対象の文の頭の〔 〕には「${word}」が入る。この言葉は${rels.join("または")}の関係を表す。` +
  "前に書かれたことと対象の文の関係は、この言葉が表す関係に合っているか。";
const REL_ASK_C = {
  true: "前に書かれたことと対象の文が、その関係でつながっている",
  false:
    "その関係ではつながっていない(逆のこと、並べること、言い換えなど、別の関係になっている)",
};

type Question =
  | {
      type: "noul";
      instructions: string;
      criteria: { true: string; false: string };
    }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };
type State = Record<string, string>;
/** 境目ごとに送る 1 つの問い。pick は選ばせる問いで、確率を足す選択肢 */
type Item = {
  id: string;
  state: State;
  q: Question;
  pick?: readonly string[];
};

const FOLLOWS: Question = {
  type: "noul",
  instructions: FLOAT_BEFORE,
  criteria: FLOAT_CRITERIA,
};
const FITS: Question = {
  type: "noul",
  instructions: FIT_ANY,
  criteria: FIT_ANY_C,
};
const CHOOSE: Question = { type: "choice", instructions: MASK, criteria: REL };

type Full = { by: "full"; explain: "once" | "each" };
/** 文脈に渡す範囲。ctx2 は前の 2 文を文脈の代わりに、full は全文を渡す(docs/design/cli.md「問いと送り方」「全文を 1 回にまとめる」) */
export type Context = Range | { by: "ctx2" } | Full;
export const ALL: Context = { by: "all" };
export const CONTEXTS =
  "all, ctx2, s<N>, s<N>-ba, para, para-ba, sec, sec-ba, sec2, sec2-ba, full-once, full-each";

export function contextOf(name: string): Context | undefined {
  const f = name.match(/^full-(once|each)$/);
  if (f) return { by: "full", explain: f[1] as Full["explain"] };
  const m = name.match(/^(s([1-9]\d*)|para|sec2?|all|ctx2)(-ba)?$/);
  if (!m) return undefined;
  const after = Boolean(m[3]);
  if (m[2]) return { by: "sents", n: Number(m[2]), after };
  if (m[1] === "para") return { by: "para", after };
  if (m[1].startsWith("sec"))
    return { by: "sec", n: m[1] === "sec2" ? 2 : 1, after };
  if (after) return undefined;
  return m[1] === "all" ? ALL : { by: "ctx2" };
}

const headings = (doc: Doc, r: Range): State =>
  r.by === "sec" ? { 見出しの一覧: doc.headings.join(" / ") } : {};

// docs/design/cli.md「全文を 1 回にまとめる」参照
function full(
  doc: Doc,
  b: Boundary,
  r: Full,
  how: string,
  criteria: { true: string; false: string },
): Item {
  const 本文 = numbered(doc);
  const once = r.explain === "once";
  return {
    id: `s${b.at}`,
    state: once ? { 判定の説明: how, 本文 } : { 本文 },
    q: {
      type: "noul",
      instructions: once
        ? `文 [${b.at}] について、「判定の説明」のとおりに判定する。`
        : `文 [${b.at}] について。${how}`,
      criteria,
    },
  };
}
const S1: Range = { by: "sents", n: 1, after: false };

// docs/design/cli.md「接続詞を見る」参照
const fitItem = (doc: Doc, b: Boundary, r: Range | Full): Item =>
  r.by === "full"
    ? full(doc, b, r, FIT_FULL, FIT_ANY_C)
    : {
        id: "q",
        q: FITS,
        state: {
          ...headings(doc, r),
          見出し: b.heading,
          文脈: context(doc, b, undefined, r),
        },
      };
const masked = (
  doc: Doc,
  b: Boundary,
  r: Range | Full,
  w: { rest: string },
): State => {
  const m = r.by === "full" ? S1 : r;
  return {
    ...headings(doc, m),
    見出し: b.heading,
    文脈: context(doc, b, `〔 〕${w.rest}`, m),
  };
};

type Second = (
  doc: Doc,
  b: Boundary,
  r: Range | Full,
  w: NonNullable<ReturnType<typeof headWord>>,
) => Item;

const choiceItem: Second = (doc, b, r, w) => ({
  id: "q",
  q: CHOOSE,
  pick: w.rels,
  state: masked(doc, b, r, w),
});

const relItem: Second = (doc, b, r, w) => {
  const word = b.next
    .slice(0, b.next.length - w.rest.length)
    .replace(/、$/, "");
  return {
    id: "q",
    q: {
      type: "noul",
      instructions: REL_ASK(word, w.rels),
      criteria: REL_ASK_C,
    },
    state: masked(doc, b, r, w),
  };
};

function withSecond(label: string, second: Second) {
  return (doc: Doc, b: Boundary, r: Context): Item[] => {
    if (r.by === "ctx2") throw new Error(`ctx2 は ${label} では使えない`);
    const first = fitItem(doc, b, r);
    const w = headWord(b.next);
    if (!w) return [first];
    return [first, second(doc, b, r, w)];
  };
}

const MODES = {
  default: (doc: Doc, b: Boundary, r: Context): Item[] => {
    if (r.by === "full") return [full(doc, b, r, FLOAT_FULL, FLOAT_CRITERIA)];
    if (r.by === "ctx2")
      return [
        {
          id: "follows",
          q: { type: "noul", instructions: CTX2, criteria: CTX2_CRITERIA },
          state: {
            見出し: b.heading,
            前の前の文: b.before,
            前の文: b.prev,
            後ろの文: b.next,
          },
        },
      ];
    const after = r.by !== "all" && r.after;
    return [
      {
        id: "follows",
        q: after ? { ...FOLLOWS, instructions: FLOAT_BOTH } : FOLLOWS,
        state: {
          ...headings(doc, r),
          見出し: b.heading,
          文脈: context(doc, b, undefined, r),
          対象の文: b.next,
        },
      },
    ];
  },
  connectives: withSecond("--connectives", relItem),
  "connectives-choice": withSecond("--connectives-choice", choiceItem),
};
export type Mode = keyof typeof MODES;
export const MODE_NAMES = Object.keys(MODES) as Mode[];
// price は 100 万トークンあたりの USD
type Provider = {
  keys: readonly string[];
  price: number;
  charsPerToken: number;
  /** 1 回の本文の字数の上限。同じ state の問いをここまで 1 回にまとめる */
  batch: number;
  /** on に当たる 400 で、headers を足して 1 回だけ送り直す */
  long: { on: RegExp; headers: Record<string, string> };
  request(
    state: State,
    questions: Record<string, Question>,
    keys: string[],
  ): { url: string; token: string; body: unknown };
};

export const PROVIDERS = {
  jev: {
    keys: ["TYPESAFE_API_KEY"],
    price: 0.042,
    charsPerToken: 0.8,
    // docs/design/cli.md「全文を 1 回にまとめる」参照
    batch: 60_000,
    // docs/design/cli.md「問いと送り方」参照
    long: {
      on: /max_tokens_exceeded/,
      headers: { "TypeSafe-Danger-Zone-Long-Context": "true" },
    },
    request: (state, questions, [token]) => ({
      url: "https://api.typesafe.ai/v1/systemone",
      token,
      body: { model: "jev-1.14.0", state, questions },
    }),
  },
} satisfies Record<string, Provider>;

export type ProviderName = keyof typeof PROVIDERS;

/** names を環境変数、無ければ file の KEY=VALUE の行から読む */
export function readKeys(
  env: NodeJS.ProcessEnv,
  file: string,
  names: readonly string[],
): Record<string, string | undefined> {
  let lines: string[] = [];
  try {
    lines = readFileSync(file, "utf8").split(/\r?\n/);
  } catch {}
  const fromFile = (name: string) => {
    for (const line of lines) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)=(.*)$/);
      if (m?.[1] === name)
        return m[2].trim().replace(/^['"]|['"]$/g, "") || undefined;
    }
    return undefined;
  };
  return Object.fromEntries(
    names.map((name) => [name, env[name] || fromFile(name)]),
  );
}

type Answer = {
  type?: string;
  noul?: number;
  probabilities?: Record<string, unknown>;
};

type Value = { p: number } | { probs: Record<string, number> };
/** 取り置き。鍵は送る本文の sha256、model は答えが返した版。選ばせる問いは選択肢ごとの確率を持つ */
export type Cache = Record<string, Value & { model: string; at: number }>;

type Reply = {
  model: string;
  tokens: number;
  values: (Value | null)[];
  why?: string;
};

const shape = (v: unknown): Question["type"] | undefined => {
  const e = v as { p?: unknown; probs?: unknown } | undefined;
  if (typeof e?.p === "number") return "noul";
  const ps =
    e?.probs && typeof e.probs === "object" ? Object.values(e.probs) : [];
  if (ps.length && ps.every((x) => typeof x === "number")) return "choice";
};

function value(a: Answer | undefined, type: Question["type"]): Value | null {
  const v = type === "noul" ? { p: a?.noul } : { probs: a?.probabilities };
  return shape(v) === type ? (v as Value) : null;
}

function reply(text: string, items: readonly Item[]): Reply {
  type Body = {
    model?: unknown;
    answers?: Record<string, Answer>;
    usage?: { input_tokens?: unknown };
  };
  let res: Body;
  try {
    res = (JSON.parse(text) ?? {}) as Body;
  } catch {
    throw new Error("HTTP 200 の本文が JSON でない");
  }
  let why: string | undefined;
  const values = items.map(({ id, q }) => {
    const a = res.answers?.[id];
    const v = value(a, q.type);
    if (!v) why ??= a?.type ?? "answers が空";
    return v;
  });
  const tokens = res.usage?.input_tokens;
  return {
    model: typeof res.model === "string" ? res.model : "",
    tokens: typeof tokens === "number" ? tokens : 0,
    values,
    why,
  };
}

async function ask({ url, token, body, long }: Call): Promise<string> {
  for (let attempt = 0, wide = false; ; ) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(wide && long.headers),
      },
      body,
      signal: AbortSignal.timeout(60_000),
    })
      .then(async (r) => ({ status: r.status, ok: r.ok, text: await r.text() }))
      .catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    if (!(r instanceof Error) && r.ok) return r.text;
    const tooLong =
      !(r instanceof Error) && r.status === 400 && long.on.test(r.text);
    if (tooLong && !wide) {
      wide = true;
      continue;
    }
    const retry =
      r instanceof Error ||
      (RETRY.includes(r.status) && !/insufficient_quota/.test(r.text));
    if (!retry || attempt >= 3)
      throw new Error(
        r instanceof Error
          ? r.message
          : `HTTP ${r.status} ${r.text.slice(0, 300)}`,
      );
    await new Promise((res) => setTimeout(res, 2 ** attempt++ * 1000));
  }
}

// hash は問いを 1 つだけ送るときの本文の sha256(docs/design/cli.md「取り置き」参照)
type Req = Item & { hash: string };
type Call = {
  url: string;
  token: string;
  body: string;
  long: Provider["long"];
  items: Req[];
};

const bodyOf = (p: Provider, items: readonly Item[], keys: string[]) => {
  const r = p.request(
    items[0].state,
    Object.fromEntries(items.map((i) => [i.id, i.q])),
    keys,
  );
  return {
    url: r.url,
    token: r.token,
    body: JSON.stringify(r.body),
    long: p.long,
  };
};

export function requests(
  doc: Doc,
  name: ProviderName,
  mode: Mode,
  ctx: Context,
): Req[][] {
  return doc.boundaries.map((b) =>
    MODES[mode](doc, b, ctx).map((item) => ({
      ...item,
      hash: createHash("sha256")
        .update(bodyOf(PROVIDERS[name], [item], []).body)
        .digest("hex"),
    })),
  );
}

// docs/design/cli.md「全文を 1 回にまとめる」参照
function pack(
  reqs: readonly Req[],
  name: ProviderName,
  keys: string[],
): Call[] {
  const p: Provider = PROVIDERS[name];
  const groups = new Map<string, Req[][]>();
  for (const r of reqs) {
    const key = JSON.stringify(r.state);
    const g = groups.get(key) ?? [];
    groups.set(key, g);
    const last = g.at(-1);
    if (
      last &&
      !last.some((x) => x.id === r.id) &&
      bodyOf(p, [...last, r], keys).body.length <= p.batch
    )
      last.push(r);
    else g.push([r]);
  }
  return [...groups.values()]
    .flat()
    .map((items) => ({ ...bodyOf(p, items, keys), items }));
}

/** reqs を送るときの見積もり。usd は入力のトークンだけの額(docs/design/cli.md「費用の見積もりと上限」)。sent は問い、calls は呼び出しの数 */
export function bill(reqs: readonly Req[], name: ProviderName) {
  const p = PROVIDERS[name];
  const cs = pack(reqs, name, []);
  const chars = cs.reduce((n, c) => n + c.body.length, 0);
  const tokens = Math.round(chars / p.charsPerToken);
  return {
    tokens,
    usd: (tokens * p.price) / 1e6,
    sent: reqs.length,
    calls: cs.length,
  };
}

export const live = (
  v: Cache[string] | undefined,
  now: number,
  type = shape(v),
) =>
  type !== undefined &&
  shape(v) === type &&
  typeof v?.model === "string" &&
  typeof v.at === "number" &&
  now - v.at <= TTL;

const read = (v: Cache[string], pick?: readonly string[]) =>
  "probs" in v ? (pick ?? []).reduce((n, k) => n + (v.probs[k] ?? 0), 0) : v.p;

/** 送る前の見積もり。生きた取り置きのある問いは数えない。bodies は聞く問いの数 */
export function estimate(
  doc: Doc,
  name: ProviderName,
  cache: Cache = {},
  mode: Mode = "default",
  ctx = ALL,
) {
  const now = Date.now();
  const all = requests(doc, name, mode, ctx).flat();
  const todo = all.filter((r) => !live(cache[r.hash], now, r.q.type));
  return { ...bill(todo, name), bodies: all.length };
}

async function pool<T>(
  items: readonly T[],
  jobs: number,
  run: (x: T) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const x = items[next++];
      try {
        await run(x);
      } catch (e) {
        next = items.length;
        throw e;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, worker),
  );
}

/** doc.boundaries と同じ順に確率(問いが 2 つなら低い方)を返す。keys は PROVIDERS[name].keys の順。cache に無いか古い問いだけ送り、届いた答えを cache に書く。1 件でも欠けるか失敗したら残りを送らずに投げる。billed は usage.input_tokens の和 */
export async function score(
  doc: Doc,
  name: ProviderName,
  keys: string[],
  cache: Cache = {},
  mode: Mode = "default",
  ctx = ALL,
  jobs = 6,
): Promise<{ probs: number[]; sent: number; calls: number; billed: number }> {
  const now = Date.now();
  for (const [k, v] of Object.entries(cache))
    if (!live(v, now)) delete cache[k];
  const byBoundary = requests(doc, name, mode, ctx);
  const reqs = byBoundary.flat();
  const fresh = new Set<string>();
  let sent = 0;
  let calls = 0;
  let billed = 0;
  const fail = (message: string) => {
    const why = keys.reduce(
      (m, k) => (k ? m.replaceAll(k, "***") : m),
      message,
    );
    return new Error(`${name}: ${why.replace(/\s+/g, " ")}`);
  };
  const send = (todo: Req[]) =>
    pool(pack(todo, name, keys), jobs, async (c) => {
      sent += c.items.length;
      calls++;
      const r = await ask(c)
        .then((text) => reply(text, c.items))
        .catch((e: Error) => {
          throw fail(e.message);
        });
      billed += r.tokens;
      r.values.forEach((v, k) => {
        if (v)
          cache[c.items[k].hash] = { ...v, model: r.model, at: Date.now() };
      });
      if (r.why !== undefined) throw fail(`HTTP 200 答えが無い(${r.why})`);
      fresh.add(r.model);
    });
  await send(reqs.filter((r) => !live(cache[r.hash], now, r.q.type)));
  // docs/design/cli.md「取り置き」参照
  if (fresh.size)
    await send(reqs.filter((r) => !fresh.has(cache[r.hash].model)));
  const probs = byBoundary.map((rs) =>
    Math.min(...rs.map((r) => read(cache[r.hash], r.pick))),
  );
  return { probs, sent, calls, billed };
}
