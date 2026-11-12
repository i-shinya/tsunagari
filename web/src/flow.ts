import { type Boundary, parse } from "../../src/markdown.ts";
import type { Row, Seen } from "../../src/page.ts";
import type { Backend } from "./infer.ts";
import {
  align,
  follow,
  land,
  type Memo,
  missing,
  type Pair,
  pairKey,
} from "./round.ts";
import { REVISION, SIZES, type Variant } from "./store.ts";

/** 押した時点の文章と境目。ダウンロードを挟んでも、押したときの文章を判定する */
export type Job = {
  readonly text: string;
  readonly boundaries: readonly Boundary[];
};
/** 取り置きに無く、判定に回す境目 */
type Todo = readonly Boundary[];
type Judging =
  | { readonly tag: "idle" }
  | { readonly tag: "loading"; readonly job: Job; readonly todo: Todo }
  | {
      readonly tag: "running";
      readonly job: Job;
      readonly todo: Todo;
      readonly done: number;
      readonly since: number;
      readonly at: number;
    };
/** after は確かめ終えたら判定する文章(軽量に替えて判定) */
type Model =
  | {
      readonly tag: "checking";
      readonly first: boolean;
      readonly after?: Job;
    }
  | { readonly tag: "absent" }
  | {
      readonly tag: "downloading";
      readonly done: number;
      readonly after: Job | undefined;
    }
  | { readonly tag: "present"; readonly judge: Judging };
/** judged は判定に回した組の数。on は 1 組も判定しなければ undefined */
type Result = {
  readonly text: string;
  readonly rows: readonly Row[];
  readonly judged: number;
  readonly ms: number;
  readonly on: Backend | undefined;
  readonly variant: Variant;
};
/** raw は文章全体の入力欄、result は本文。seen は本文で見ていた所で、初めの結果の前は undefined。draft は本文の中で直した文章 */
type Pane =
  | {
      readonly tag: "raw";
      readonly last: Result | undefined;
      readonly seen: Seen | undefined;
      readonly draft: string | undefined;
    }
  | {
      readonly tag: "result";
      readonly last: Result;
      readonly seen: Seen | undefined;
      readonly draft: string | undefined;
    };
type Ask =
  | { readonly tag: "download"; readonly job: Job }
  | { readonly tag: "delete"; readonly bytes: number }
  | { readonly tag: "swap"; readonly name: string; readonly text: string };
export type Spot = "run" | "get" | "fetch" | "del" | "raw" | "back" | "open";
type Note = { readonly at: Spot; readonly text: string };
/** 止まった知らせ。after は取り終えたら判定するか */
type Stall =
  | { readonly tag: "stopped" | "lost"; readonly after: boolean }
  | { readonly tag: "broke" };
/** 保存の様子。missing は版ごとのまだ取っていないバイト数、stored は保存の全部のバイト数 */
export type Look = {
  readonly missing: Readonly<Record<Variant, number>>;
  readonly stored: number;
};
/** op は受け取る非同期の仕事の番号で、by はそれを始めたボタン(失敗の文はそこに出す) */
export type State = Look & {
  readonly op: number;
  readonly by: Spot;
  readonly variant: Variant;
  readonly model: Model;
  readonly pane: Pane;
  readonly ask: Ask | undefined;
  readonly note: Note | undefined;
  readonly stall: Stall | undefined;
  readonly error: string;
  readonly memo: Memo;
};

/** picked の now は今の文章(入力欄か本文) */
export type Event =
  | { type: "press"; at: Spot; text: string }
  | { type: "answer"; yes: boolean }
  | { type: "picked"; name: string; text: string; now: string }
  | { type: "seen"; seen: Seen }
  | { type: "fix"; from: number; to: number; text: string }
  | { type: "stop" }
  | { type: "resume"; text: string }
  | { type: "light"; text: string }
  | { type: "dismiss" }
  | { type: "variant"; variant: Variant }
  | ({ type: "checked"; op: number } & Look)
  | { type: "bytes"; op: number; done: number }
  | ({ type: "fetched"; op: number; stopped: boolean } & Look)
  | { type: "opened"; op: number; at: number }
  | { type: "step"; op: number; done: number; at: number }
  | {
      type: "judged";
      op: number;
      ps: readonly number[];
      on: Backend;
      at: number;
    }
  | { type: "measured"; op: number; bytes: number }
  | { type: "cleared"; op: number }
  | {
      type: "failed";
      op: number;
      did: Effect["do"];
      name: string;
      error: string;
    };
/** fill は入力欄をその文章にする。pick はファイルを選ばせる */
export type Effect =
  | { do: "check"; op: number }
  | { do: "download"; op: number; variant: Variant }
  | { do: "stop"; op: number }
  | {
      do: "judge";
      op: number;
      variant: Variant;
      boundaries: readonly Boundary[];
    }
  | { do: "measure"; op: number }
  | { do: "clear"; op: number }
  | { do: "fill"; op: number; text: string }
  | { do: "pick"; op: number };
export type Step = { readonly state: State; readonly run: readonly Effect[] };

/** dock は判定の帯の「判定する」の行を出すか。again・slot は判定し直す文の数の文(帯とシートの頭)。bare は保存した版が 1 つも無いと分かっているか */
export type View = {
  pane: Pane["tag"];
  run: "判定する" | "判定し直す";
  dock: boolean;
  again: string;
  slot: string;
  back: boolean;
  frozen: boolean;
  off: Record<Spot, boolean>;
  get: boolean;
  stop: boolean;
  variant: Variant;
  locked: boolean;
  saved: boolean;
  bare: boolean;
  kept: string;
  lack: string;
  bar: undefined | "wait" | { value: number; max: number };
  status: string;
  count: string;
  mark: string;
  tech: string;
  error: string;
  notes: Record<Spot, string>;
  stall:
    | undefined
    | {
        text: string;
        resume: boolean;
        dismiss: boolean;
        light: boolean;
        retry: boolean;
        /** 失敗の朱の枠にするか(使う人が止めたときは白) */
        err: boolean;
      };
  ask:
    | undefined
    | {
        text: string;
        yes: string;
        danger: boolean;
        at: "dock" | "set" | "top";
      };
};

export type Device = { memory: number | undefined; mobile: boolean };
/** deviceMemory は Chromium だけで 8 が上限なので、undefined は「分からない」 */
export const pickVariant = (d: Device): Variant =>
  d.mobile || (d.memory !== undefined && d.memory < 8) ? "q8" : "fp16";

/** gap は GPU で動かせない理由(動かせるなら undefined)、asked は URL の backend */
export function backendFor(
  gap: string | undefined,
  asked: string | null,
): Backend {
  if (asked === "wasm") return "wasm";
  if (gap === undefined) return "webgpu";
  if (asked === "webgpu")
    throw new Error(
      `WebGPU で動かせません(${gap})。?backend=webgpu を外すと wasm で動きます`,
    );
  return "wasm";
}

const MB = 1e6;
// 丸めは docs/design/web.md「ページ」参照
function size(bytes: number): string {
  const mb = bytes / MB;
  if (mb >= 995) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb < 10 ? Math.round(mb) : Math.round(mb / 10) * 10} MB`;
}
export const about = (bytes: number) => `約 ${size(Math.max(MB, bytes))}`;
const NAME: Record<Variant, string> = { fp16: "標準", q8: "軽量" };
const VARIANTS: readonly Variant[] = ["fp16", "q8"];
const IDLE: Model = { tag: "present", judge: { tag: "idle" } };
const ABSENT: Model = { tag: "absent" };
const CHECKING: Model = { tag: "checking", first: false };
const NOTHING: Look = { missing: SIZES, stored: 0 };
const ASK = "先に確かめに答えてください";

export function start(d: Device): Step {
  const state: State = {
    ...NOTHING,
    op: 1,
    by: "run",
    variant: pickVariant(d),
    model: { tag: "checking", first: true },
    pane: { tag: "raw", last: undefined, seen: undefined, draft: undefined },
    ask: undefined,
    note: undefined,
    stall: undefined,
    error: "",
    memo: new Map(),
  };
  return { state, run: [{ do: "check", op: 1 }] };
}

const keep = (state: State): Step => ({ state, run: [] });
const busy = (m: Model) =>
  m.tag === "downloading" || (m.tag === "present" && m.judge.tag !== "idle");
const judgingNow = (m: Model) => m.tag === "present" && m.judge.tag !== "idle";
/** 押した文章を判定し終えるまでの間。入力欄は読むだけにする */
const pending = (m: Model) =>
  judgingNow(m) ||
  ((m.tag === "downloading" || m.tag === "checking") && m.after !== undefined);
const look = (s: State, l: Look): State => ({
  ...s,
  missing: l.missing,
  stored: l.stored,
});
const saved = (s: State) => VARIANTS.filter((v) => s.missing[v] === 0);

function begin(
  s: State,
  by: Spot,
  model: Model,
  effect: (op: number) => Effect,
): Step {
  const op = s.op + 1;
  return { state: { ...s, op, by, model }, run: [effect(op)] };
}
function judging(s: State, job: Job): Step {
  const todo = missing(s.memo, REVISION, s.variant, job.boundaries);
  if (todo.length === 0)
    return finish({ ...s, op: s.op + 1, by: "run" }, job, [], [], undefined, 0);
  const judge: Judging = { tag: "loading", job, todo };
  return begin(s, "run", { tag: "present", judge }, (op) => ({
    do: "judge",
    op,
    variant: s.variant,
    boundaries: todo,
  }));
}

type Shown = Boundary & { p: number | null; was?: number };
/** 本文に出す文章と行。直した文章は取り置きに無い組を未判定(p: null)にする。docs/design/web.md「判定し直し」参照 */
export function shown(s: State): { text: string; rows: readonly Shown[] } {
  const { last, draft } = s.pane;
  if (!last) return { text: "", rows: [] };
  if (draft === undefined) return { text: last.text, rows: last.rows };
  const key = (b: Boundary) => pairKey(REVISION, last.variant, b);
  const old = new Map(last.rows.map((r) => [key(r), r.was]));
  const rows = parse(draft, false).boundaries.map((b) => {
    const was = old.get(key(b));
    const p = s.memo.get(key(b)) ?? null;
    return { ...b, p, ...(was === undefined ? {} : { was }) };
  });
  return { text: draft, rows };
}

function carry(
  seen: Seen,
  pair: Pair,
  old: readonly string[],
  now: readonly string[],
): Seen {
  const top = seen.top && follow(pair, seen.top.i);
  return {
    cur: land(old, now, pair, seen.cur),
    mode: seen.mode,
    top: seen.top && top !== null ? { i: top, dy: seen.top.dy } : null,
  };
}

/** was は前の回と組が合い、同じ版で、鍵が変わった行に付ける。選んでいた文が消えて、組んでいない行へ移ったときはその行に付けない */
function finish(
  s: State,
  job: Job,
  todo: Todo,
  ps: readonly number[],
  on: Backend | undefined,
  ms: number,
): Step {
  const key = (b: Boundary) => pairKey(REVISION, s.variant, b);
  const memo = new Map([
    ...s.memo,
    ...todo.map((b, k) => [key(b), ps[k]] as const),
  ]);
  const model = s.model.tag === "present" ? IDLE : s.model;
  const { draft } = s.pane;
  // 判定の間に本文の中で直したときは、直した文章のまま数だけが埋まる
  if (s.pane.tag === "result" && shown(s).text !== job.text)
    return keep({ ...s, memo, model, error: "", note: undefined });
  const prev = s.pane.last;
  const old = prev ? prev.rows.map((r) => r.next) : [];
  const now = job.boundaries.map((b) => b.next);
  const pair = prev ? align(old, now) : [];
  // seen は控えたときに出していた本文(直した文章があればその行)の番号
  const looked = draft === undefined ? old : shown(s).rows.map((r) => r.next);
  const lookedPair = draft === undefined ? pair : align(looked, now);
  const was = s.pane.seen;
  const seen = was && carry(was, lookedPair, looked, now);
  const picked = was?.cur ?? null;
  const lost =
    seen !== undefined &&
    seen.cur !== null &&
    picked !== null &&
    now[seen.cur] !== looked[picked] &&
    lookedPair[seen.cur] !== picked;
  const rows = job.boundaries.map((b, j): Row => {
    const row = { ...b, p: memo.get(key(b)) as number };
    const o = pair[j];
    if (!prev || prev.variant !== s.variant || o === undefined) return row;
    if ((lost && j === seen.cur) || key(prev.rows[o]) === key(b)) return row;
    return { ...row, was: prev.rows[o].p };
  });
  const last: Result = {
    text: job.text,
    rows,
    judged: todo.length,
    ms,
    on,
    variant: s.variant,
  };
  return keep({
    ...s,
    memo,
    model,
    error: "",
    pane: { tag: "result", last, seen, draft: undefined },
    note: undefined,
  });
}

/** 入力欄の面に替え、入力欄を text にする */
const fill = (s: State, text: string): Step => ({
  state: { ...s, pane: { ...s.pane, tag: "raw" } },
  run: [{ do: "fill", op: s.op, text }],
});
const downloading = (s: State, by: Spot, after: Job | undefined) =>
  begin(s, by, { tag: "downloading", done: 0, after }, (op) => ({
    do: "download",
    op,
    variant: s.variant,
  }));
const check = (op: number): Effect => ({ do: "check", op });

/** 押せない理由。無ければ undefined。view の aria-disabled も同じ答えから決める */
export function why(s: State, at: Spot, job?: Job): string | undefined {
  const m = s.model;
  if (at === "raw" || at === "back" || at === "open") {
    if (s.ask) return ASK;
    if (!(at === "raw" ? busy(m) : pending(m))) return undefined;
    return m.tag === "downloading"
      ? "ダウンロードの途中です"
      : "判定の途中です";
  }
  if (s.ask && (at === "run" || at === "del")) return ASK;
  if (m.tag === "checking") return "確かめています";
  if (m.tag === "downloading")
    return at !== "run"
      ? "ダウンロードの途中です"
      : m.after
        ? "ダウンロードが終わるとそのまま判定します"
        : "ダウンロードが終わると判定できます";
  if ((at === "get" || at === "fetch") && m.tag === "present")
    return "ダウンロード済みです";
  if (busy(m)) return "判定の途中です";
  if (at === "del" && s.stored === 0) return "削除するモデルはありません";
  if (at !== "run" || job === undefined) return undefined;
  if (job.text.trim() === "") return "先に文章を貼ってください";
  if (job.boundaries.length === 0)
    return "見出しだけでは判定できません。文を 2 つ以上貼ってください";
}

/** 失敗を使う人の言葉にする。元の文は設定の中に出す */
export function words(did: Effect["do"], name: string): string {
  if (name === "QuotaExceededError")
    return "この端末では保存できませんでした。シークレットウィンドウでは容量が足りないことがあります";
  if (did === "measure" || did === "clear")
    return "削除できませんでした。もう一度押してください";
  return "判定できませんでした。もう一度押してください";
}

const jobOf = (text: string): Job => ({
  text,
  boundaries: parse(text, false).boundaries,
});
function press(was: State, at: Spot, text: string): Step {
  const job = at === "run" ? jobOf(text) : undefined;
  const reason = why(was, at, job);
  if (reason !== undefined) return keep({ ...was, note: { at, text: reason } });
  const s = { ...was, stall: undefined };
  const p = s.pane;
  if (job !== undefined) {
    const known = missing(s.memo, REVISION, s.variant, job.boundaries);
    return s.model.tag === "present" || known.length === 0
      ? judging(s, job)
      : keep({ ...s, ask: { tag: "download", job } });
  }
  switch (at) {
    case "del":
      return begin(s, "del", s.model, (op) => ({ do: "measure", op }));
    case "raw":
      return p.tag === "result" ? fill(s, shown(s).text) : keep(s);
    case "back":
      if (p.tag === "result" || !p.last) return keep(s);
      return {
        state: { ...s, pane: { ...p, tag: "result", last: p.last } },
        run: [{ do: "fill", op: s.op, text: shown(s).text }],
      };
    case "open":
      return { state: s, run: [{ do: "pick", op: s.op }] };
  }
  return downloading(s, at, undefined);
}

/** ページの決まりの全部。古い op の知らせは何も変えない */
export function next(s: State, e: Event): Step {
  if ("op" in e && e.op !== s.op) return keep(s);
  const m = s.model;
  switch (e.type) {
    case "press":
      return press({ ...s, note: undefined }, e.at, e.text);
    case "answer": {
      const t = { ...s, ask: undefined };
      if (!e.yes || s.ask === undefined) return keep(t);
      if (s.ask.tag === "download") return downloading(t, "run", s.ask.job);
      if (s.ask.tag === "swap") return fill(t, s.ask.text);
      return begin(t, "del", CHECKING, (op) => ({ do: "clear", op }));
    }
    case "picked": {
      const reason = why(s, "open");
      if (reason !== undefined)
        return keep({ ...s, note: { at: "open", text: reason } });
      const t = { ...s, note: undefined };
      if (e.now.trim() === "") return fill(t, e.text);
      return keep({ ...t, ask: { tag: "swap", name: e.name, text: e.text } });
    }
    case "fix": {
      const p = s.pane;
      if (p.tag !== "result") return keep(s);
      const now = shown(s).text;
      if (now.slice(e.from, e.to) === e.text) return keep(s);
      const text = now.slice(0, e.from) + e.text + now.slice(e.to);
      const draft = text === p.last.text ? undefined : text;
      return keep({ ...s, pane: { ...p, draft } });
    }
    case "seen": {
      const n = shown(s).rows.length;
      const { cur, top } = e.seen;
      if ((cur ?? 0) >= n || (top?.i ?? 0) >= n) return keep(s);
      return keep({ ...s, pane: { ...s.pane, seen: e.seen } });
    }
    case "stop":
      return m.tag === "downloading"
        ? { state: s, run: [{ do: "stop", op: s.op }] }
        : keep(s);
    // docs/design/web.md「重みの取り方と保存」参照
    case "resume": {
      const st = s.stall;
      if (st === undefined || st.tag === "broke") return keep(s);
      const job = st.after ? jobOf(e.text) : undefined;
      const t = { ...s, note: undefined };
      const reason = why(t, job ? "run" : "get", job);
      if (reason !== undefined)
        return keep({ ...t, note: { at: job ? "run" : s.by, text: reason } });
      return downloading({ ...t, stall: undefined }, s.by, job);
    }
    case "light": {
      if (s.stall?.tag !== "broke" || s.variant === "q8") return keep(s);
      const job = jobOf(e.text);
      const t = { ...s, note: undefined };
      const reason = why(t, "run", job);
      if (reason !== undefined)
        return keep({ ...t, note: { at: "run", text: reason } });
      return begin(
        { ...t, variant: "q8", stall: undefined },
        "run",
        { tag: "checking", first: false, after: job },
        check,
      );
    }
    case "dismiss":
      return keep({ ...s, stall: undefined });
    case "variant":
      if (e.variant === s.variant || busy(m) || s.ask) return keep(s);
      return begin(
        { ...s, variant: e.variant, note: undefined, stall: undefined },
        "run",
        CHECKING,
        check,
      );
    case "checked": {
      const t = look(s, e);
      const only = saved(t).length === 1 ? saved(t)[0] : undefined;
      const variant =
        m.tag === "checking" && m.first ? (only ?? s.variant) : s.variant;
      const gone = s.by === "del" && e.stored === 0;
      const model = t.missing[variant] === 0 ? IDLE : ABSENT;
      // 確かめ直して全部あれば、続きから取る知らせは要らない
      const fetched = model === IDLE && s.stall?.tag !== "broke";
      const u: State = {
        ...t,
        variant,
        model,
        ...(gone && { note: undefined, error: "" }),
        ...(fetched && { stall: undefined }),
      };
      const after = m.tag === "checking" ? m.after : undefined;
      if (after === undefined) return keep(u);
      return u.model === IDLE
        ? judging(u, after)
        : keep({ ...u, ask: { tag: "download", job: after } });
    }
    case "bytes":
      return m.tag === "downloading"
        ? keep({ ...s, model: { ...m, done: e.done } })
        : keep(s);
    case "fetched": {
      if (m.tag !== "downloading") return keep(s);
      const t = look(s, e);
      if (e.stopped) {
        const stall = { tag: "stopped", after: !!m.after } as const;
        return keep({ ...t, model: ABSENT, stall, note: undefined });
      }
      const u = { ...t, note: undefined, error: "" };
      return m.after ? judging(u, m.after) : keep({ ...u, model: IDLE });
    }
    case "opened":
      if (m.tag !== "present" || m.judge.tag !== "loading") return keep(s);
      return keep({
        ...s,
        model: {
          ...m,
          judge: {
            tag: "running",
            job: m.judge.job,
            todo: m.judge.todo,
            done: 0,
            since: e.at,
            at: e.at,
          },
        },
      });
    case "step":
      if (m.tag !== "present" || m.judge.tag !== "running") return keep(s);
      return keep({
        ...s,
        model: { ...m, judge: { ...m.judge, done: e.done, at: e.at } },
      });
    case "judged": {
      if (m.tag !== "present" || m.judge.tag !== "running") return keep(s);
      const { job, todo, since } = m.judge;
      return finish(s, job, todo, e.ps, e.on, e.at - since);
    }
    case "measured":
      if (s.ask) return keep({ ...s, note: { at: "del", text: ASK } });
      return e.bytes === 0
        ? keep({
            ...s,
            stored: 0,
            note: { at: "del", text: "削除するモデルはありません" },
          })
        : keep({ ...s, ask: { tag: "delete", bytes: e.bytes } });
    case "cleared":
      return keep({
        ...look(s, NOTHING),
        model: ABSENT,
        error: "",
        note: { at: "del", text: "削除しました" },
      });
    case "failed": {
      // 容量切れは続きから取っても直らないので、知らせの文だけにする
      const stall: Stall | undefined =
        e.name === "QuotaExceededError"
          ? undefined
          : m.tag === "downloading"
            ? { tag: "lost", after: !!m.after }
            : judgingNow(m) || (m.tag === "checking" && m.after)
              ? { tag: "broke" }
              : undefined;
      const t = {
        ...s,
        ask: undefined,
        error: e.error,
        stall: stall ?? s.stall,
        note: stall
          ? undefined
          : e.did === "check"
            ? s.note
            : { at: s.by, text: words(e.did, e.name) },
      };
      if (m.tag === "downloading" || e.did === "clear")
        return begin(t, s.by, ABSENT, check);
      if (m.tag === "checking") return keep({ ...t, model: ABSENT });
      return keep({ ...t, model: m.tag === "present" ? IDLE : m });
    }
  }
}

/** 「あと約 40 秒」「あと約 3 分」。1 組目が終わるまでは "" */
export function eta(
  done: number,
  total: number,
  since: number,
  at: number,
): string {
  if (done === 0 || done >= total) return "";
  const rest = ((at - since) / done) * (total - done);
  const sec = Math.ceil(rest / 1000);
  return sec < 60 ? `あと約 ${sec} 秒` : `あと約 ${Math.ceil(rest / 60000)} 分`;
}

/** [進み具合の棒, 段の名前(role=status), 変わり続ける数] */
function progress(s: State): [View["bar"], string, string] {
  const m = s.model;
  if (m.tag === "downloading") {
    const need = s.missing[s.variant];
    const got = Math.max(0, m.done - (SIZES[s.variant] - need));
    return [
      { value: got, max: need },
      "モデルをダウンロードしています",
      `${size(got)} / ${about(need)}`,
    ];
  }
  if (m.tag !== "present" || m.judge.tag === "idle") return [undefined, "", ""];
  if (m.judge.tag === "loading") return ["wait", "判定の準備をしています", ""];
  const { todo, done, since, at } = m.judge;
  const total = todo.length;
  const left = eta(done, total, since, at);
  return [
    { value: done, max: total },
    "判定しています",
    `${done} / ${total}${left && `(${left})`}`,
  ];
}

const names = (s: State) => saved(s).map((v) => NAME[v]);
function kept(s: State): string {
  if (s.stored === 0) return "";
  const n = names(s);
  const what = n.length
    ? `${n.join("と")}(${about(s.stored)})`
    : about(s.stored);
  return `この端末に保存済み: ${what}`;
}

function removal(s: State, bytes: number): string {
  const n = names(s);
  const what =
    n.length === 2
      ? `${n.join("と")}(合わせて${about(bytes)})`
      : `${n[0] ?? "保存したモデル"}(${about(bytes)})`;
  return `${what}をこの端末から削除します。次に判定するときに、またダウンロードします。`;
}

function fetching(s: State): string {
  const v = s.variant;
  const need = about(s.missing[v]);
  const head = saved(s).length
    ? `${NAME[v]}のモデル(${about(SIZES[v])})のうち、まだ無い${need} を`
    : `初回だけ${need} のモデル(${NAME[v]})を`;
  return `${head}ダウンロードします。この端末に保存し、文章は送りません。`;
}

function ask(s: State): View["ask"] {
  const a = s.ask;
  if (a?.tag === "download")
    return {
      text: fetching(s),
      yes: "ダウンロードして判定",
      danger: false,
      at: "dock",
    };
  if (a?.tag === "delete")
    return {
      text: removal(s, a.bytes),
      yes: "削除する",
      danger: true,
      at: "set",
    };
  if (a?.tag === "swap")
    return {
      text: `今の文章を「${a.name}」の中身に置き換えますか`,
      yes: "置き換える",
      danger: false,
      at: "top",
    };
}

const NO_ACT = {
  resume: false,
  dismiss: false,
  light: false,
  retry: false,
  err: true,
};
function stall(s: State): View["stall"] {
  const t = s.stall?.tag;
  if (t === "stopped")
    return {
      ...NO_ACT,
      text: "ダウンロードを止めました。",
      resume: true,
      err: false,
    };
  if (t === "lost")
    return {
      ...NO_ACT,
      text: "ダウンロードが途中で止まりました。もう一度押すと、取れた所の続きから取ります。",
      resume: true,
      dismiss: true,
    };
  if (t === "broke")
    return {
      ...NO_ACT,
      text: "判定が途中で止まりました。この端末のメモリが足りないと止まることがあります。軽量のモデルに替えると動くことがあります。",
      light: s.variant === "fp16",
      retry: true,
    };
}

function tech(r: Result): string {
  const n = r.rows.length;
  const by = r.on ? `${r.variant}・${r.on}` : r.variant;
  const each = `1 組 ${(r.ms / Math.max(1, r.judged)).toFixed(1)} ms`;
  const ms = r.judged ? `(${Math.round(r.ms)} ms、${each})` : "";
  if (r.judged === n) return `${by} で ${n} 文を判定しました${ms}`;
  return `${by} で ${n} 文のうち ${r.judged} 文を判定し直しました${ms}`;
}

export const SPOTS: readonly Spot[] = [
  "run",
  "get",
  "fetch",
  "del",
  "raw",
  "back",
  "open",
];
export function view(s: State): View {
  const last = s.pane.last;
  const r = s.pane.tag === "result" ? s.pane.last : undefined;
  const [bar, status, count] = progress(s);
  const has = s.missing[s.variant] === 0;
  const left = r
    ? missing(s.memo, REVISION, s.variant, shown(s).rows).length
    : 0;
  const mark =
    r && r.variant !== s.variant ? `${NAME[r.variant]}で判定した結果です` : "";
  const each = <T>(f: (at: Spot) => T) =>
    Object.fromEntries(SPOTS.map((at) => [at, f(at)])) as Record<Spot, T>;
  return {
    pane: s.pane.tag,
    run: last ? "判定し直す" : "判定する",
    dock: !r || left > 0 || mark !== "",
    again: left ? `判定し直す文が ${left} 文あります` : "",
    slot: left ? `判定し直す(${left} 文)` : mark && "判定し直す",
    back: !r && last !== undefined,
    frozen: !r && (pending(s.model) || (!!s.ask && s.ask.tag !== "delete")),
    off: each((at) => why(s, at) !== undefined),
    get: s.stored === 0,
    stop: s.model.tag === "downloading",
    variant: s.variant,
    locked: busy(s.model),
    saved: has,
    bare:
      !(s.model.tag === "checking" && s.model.first) && saved(s).length === 0,
    kept: kept(s),
    lack:
      s.stored > 0 && !has
        ? `${NAME[s.variant]}はまだダウンロードしていません`
        : "",
    bar,
    status,
    count,
    mark,
    tech: last ? tech(last) : "",
    error: s.error,
    notes: each((at) => (s.note?.at === at ? s.note.text : "")),
    stall: stall(s),
    ask: ask(s),
  };
}
