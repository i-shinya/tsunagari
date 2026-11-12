import { expect, test } from "vitest";
import { parse } from "../../src/markdown.ts";
import { lay } from "../../src/sheet.ts";
import {
  about,
  backendFor,
  type Effect,
  type Event,
  eta,
  next,
  pickVariant,
  type State,
  shown,
  start,
  view,
  words,
} from "./flow.ts";
import { FILES, SIZES } from "./store.ts";

test.each([
  ["動かせる", undefined, null, "webgpu"],
  ["動かせない", "理由", null, "wasm"],
  ["動かせても wasm を指定した", undefined, "wasm", "wasm"],
  ["動かせなくても wasm を指定した", "理由", "wasm", "wasm"],
  ["動かせて webgpu を指定した", undefined, "webgpu", "webgpu"],
])("backendFor は GPU が%sとき %s %s で", (_, gap, asked, want) => {
  expect(backendFor(gap, asked)).toBe(want);
});

test("webgpu を指定して動かせないと理由を添えて投げる", () => {
  expect(() => backendFor("理由", "webgpu")).toThrow(
    "WebGPU で動かせません(理由)",
  );
});

type Loose<E> = E extends { op: number } ? Omit<E, "op"> & { op?: number } : E;
const TEXT = "# 見出し\n\n歩くのは三十分ほどだ。だから冷蔵庫の中身を確かめた。";
const Q8_MODEL = FILES.q8[0].bytes;
const NONE = { type: "checked", missing: SIZES, stored: 0 } as const;
const FP16 = {
  type: "checked",
  missing: { fp16: 0, q8: Q8_MODEL },
  stored: SIZES.fp16,
} as const;
const GOT = { ...FP16, type: "fetched", stopped: false } as const;
const run = { type: "press", at: "run", text: TEXT } as const;
const run2 = {
  ...run,
  text: "# 見出し\n\n歩くのは一時間ほどだ。だから冷蔵庫の中身を確かめた。",
} as const;
const BOTH = {
  ...NONE,
  missing: { fp16: 0, q8: 0 },
  stored: SIZES.fp16 + Q8_MODEL,
};
const STOPPED = { ...NONE, type: "fetched", stopped: true } as const;
const LOST = {
  type: "failed",
  did: "download",
  name: "TypeError",
  error: "x",
} as const;
const BROKE = {
  type: "failed",
  did: "judge",
  name: "Error",
  error: "WebGPU",
} as const;
const resume = { type: "resume", text: TEXT } as const;
const light = { type: "light", text: TEXT } as const;
const del = { type: "press", at: "del", text: "" } as const;
const raw = { type: "press", at: "raw", text: "" } as const;
const back = { type: "press", at: "back", text: "" } as const;
const picked = (now: string) =>
  ({ type: "picked", name: "a.md", text: "ファイルの文。", now }) as const;
const judged = [
  { type: "opened", at: 0 },
  { type: "judged", ps: [0.5], on: "wasm", at: 4 },
] as const;
const RESULT = [FP16, run, ...judged] as const;
const DELETED = [
  ...RESULT,
  del,
  { type: "measured", bytes: SIZES.fp16 },
  { type: "answer", yes: true },
  { type: "cleared" },
] as const;

/** 知らせの op を省くと、その時点の op を付けて流す */
function play(
  events: readonly Loose<Event>[],
  device = { memory: 16, mobile: false },
) {
  let { state } = start(device);
  const run: Effect[] = [];
  for (const e of events) {
    const step = next(state, { op: state.op, ...e } as Event);
    state = step.state;
    run.push(...step.run);
  }
  return { state, run, did: run.map((f) => f.do) };
}

test.each<
  [
    string,
    Loose<Event>[],
    Partial<State> | ((s: State) => unknown),
    Effect["do"][],
  ]
>([
  [
    "無いまま判定するを押すと確かめの欄が開く",
    [NONE, run],
    { ask: { tag: "download", job: expect.anything() } },
    [],
  ],
  [
    "欄でダウンロードを選ぶと、終わったらそのまま判定する",
    [NONE, run, { type: "answer", yes: true }, GOT],
    {
      model: {
        tag: "present",
        judge: expect.objectContaining({ tag: "loading" }),
      },
      stored: SIZES.fp16,
    },
    ["download", "judge"],
  ],
  [
    "判定が終わると結果の面になる",
    [
      FP16,
      run,
      { type: "opened", at: 0 },
      { type: "step", done: 1, at: 5 },
      { type: "judged", ps: [0.9], on: "wasm", at: 10 },
    ],
    (s) =>
      s.pane.tag === "result" &&
      s.pane.last.ms === 10 &&
      s.pane.last.rows.length === 1,
    ["judge"],
  ],
  [
    "先にダウンロードだけするは欄を開かず、終わっても判定しない",
    [NONE, { type: "press", at: "get", text: "" }, GOT],
    { ask: undefined, model: { tag: "present", judge: { tag: "idle" } } },
    ["download"],
  ],
  [
    "中止すると無い状態に戻り、判定するつもりだったことを残した知らせを出す",
    [NONE, run, { type: "answer", yes: true }, run, { type: "stop" }, STOPPED],
    {
      model: { tag: "absent" },
      note: undefined,
      stall: { tag: "stopped", after: true },
    },
    ["download", "stop"],
  ],
  [
    "取っている間に出た理由は、取るのに失敗したら消す",
    [NONE, run, { type: "answer", yes: true }, run, LOST],
    { note: undefined, stall: { tag: "lost", after: true } },
    ["download", "check"],
  ],
  [
    "判定している間に出た理由は、判定に失敗したら消す",
    [FP16, run, raw, BROKE],
    { note: undefined, stall: { tag: "broke" } },
    ["judge"],
  ],
  [
    "止まった後に押して理由で断られたときは、知らせを消さない",
    [FP16, run, BROKE, { ...run, text: "" }],
    {
      note: { at: "run", text: "先に文章を貼ってください" },
      stall: { tag: "broke" },
    },
    ["judge"],
  ],
  [
    "取るのに失敗した後に確かめ直して全部あれば、続きの知らせを消す",
    [NONE, run, { type: "answer", yes: true }, LOST, FP16],
    { stall: undefined, model: { tag: "present", judge: { tag: "idle" } } },
    ["download", "check"],
  ],
  [
    "軽量に替えて確かめている間は入力欄を読むだけにする",
    [FP16, run, BROKE, light],
    (s) => view(s).frozen && view(s).off.open,
    ["judge", "check"],
  ],
  [
    "軽量に替えた後の確かめに失敗したら、判定が止まった知らせを戻す",
    [
      FP16,
      run,
      BROKE,
      light,
      { type: "failed", did: "check", name: "Error", error: "y" },
    ],
    { stall: { tag: "broke" }, model: { tag: "absent" } },
    ["judge", "check"],
  ],
  [
    "中止の後に続きからダウンロードを押し、取り終えるとそのまま判定する",
    [NONE, run, { type: "answer", yes: true }, STOPPED, resume, GOT],
    {
      stall: undefined,
      model: {
        tag: "present",
        judge: expect.objectContaining({ tag: "loading" }),
      },
    },
    ["download", "download", "judge"],
  ],
  [
    "取るだけで中止した後の続きは、取り終えても判定しない",
    [NONE, { type: "press", at: "get", text: "" }, STOPPED, resume, GOT],
    { model: { tag: "present", judge: { tag: "idle" } } },
    ["download", "download"],
  ],
  [
    "中止の後に文章を直してから続きを押すと、直した文章を判定する",
    [
      NONE,
      run,
      { type: "answer", yes: true },
      STOPPED,
      { ...resume, text: run2.text },
      GOT,
    ],
    (s) =>
      s.model.tag === "present" &&
      s.model.judge.tag === "loading" &&
      s.model.judge.job.text === run2.text,
    ["download", "download", "judge"],
  ],
  [
    "取るのに失敗すると、続きからの知らせを出して保存を確かめ直す",
    [NONE, run, { type: "answer", yes: true }, LOST],
    { note: undefined, error: "x", stall: { tag: "lost", after: true } },
    ["download", "check"],
  ],
  [
    "取るのに失敗した後の続きは、確かめ直してから取り、終わると判定する",
    [NONE, run, { type: "answer", yes: true }, LOST, NONE, resume, GOT],
    {
      model: {
        tag: "present",
        judge: expect.objectContaining({ tag: "loading" }),
      },
    },
    ["download", "check", "download", "judge"],
  ],
  [
    "やめるで止まった知らせを消す",
    [NONE, run, { type: "answer", yes: true }, LOST, NONE, { type: "dismiss" }],
    { stall: undefined, model: { tag: "absent" } },
    ["download", "check"],
  ],
  [
    "保存の容量が足りずに失敗したときは、続きからの知らせを出さない",
    [
      NONE,
      run,
      { type: "answer", yes: true },
      { ...LOST, name: "QuotaExceededError" },
    ],
    {
      stall: undefined,
      note: {
        at: "run",
        text: "この端末では保存できませんでした。シークレットウィンドウでは容量が足りないことがあります",
      },
    },
    ["download", "check"],
  ],
  [
    "判定に失敗すると、止まった知らせを出す",
    [FP16, run, BROKE],
    { note: undefined, error: "WebGPU", stall: { tag: "broke" } },
    ["judge"],
  ],
  [
    "判定に失敗した後に判定するを押すと、知らせを消して判定する",
    [FP16, run, BROKE, run],
    {
      stall: undefined,
      model: {
        tag: "present",
        judge: expect.objectContaining({ tag: "loading" }),
      },
    },
    ["judge", "judge"],
  ],
  [
    "軽量に替えて判定は、軽量が保存してあればそのまま軽量で判定する",
    [BOTH, run, BROKE, light, BOTH],
    (s) =>
      s.variant === "q8" &&
      s.stall === undefined &&
      s.model.tag === "present" &&
      s.model.judge.tag === "loading",
    ["judge", "check", "judge"],
  ],
  [
    "軽量に替えて判定は、軽量が無ければダウンロードの確かめを出す",
    [FP16, run, BROKE, light, FP16],
    {
      variant: "q8",
      model: { tag: "absent" },
      ask: { tag: "download", job: expect.objectContaining({ text: TEXT }) },
    },
    ["judge", "check"],
  ],
  [
    "確かめの欄が開いている間は版を替えない",
    [NONE, run, { type: "variant", variant: "q8" }],
    {
      variant: "fp16",
      ask: {
        tag: "download",
        job: { text: TEXT, boundaries: expect.any(Array) },
      },
    },
    [],
  ],
  [
    "版を替えた後に届いた前の確かめは無視する",
    [
      { type: "variant", variant: "q8" },
      { ...FP16, op: 1 },
    ],
    { variant: "q8", model: { tag: "checking", first: false } },
    ["check"],
  ],
  [
    "取り直しの途中に届いた前のダウンロードの終わりで、保存済みにしない",
    [
      NONE,
      { type: "press", at: "get", text: "" },
      { type: "failed", did: "download", name: "TypeError", error: "x" },
      NONE,
      { type: "press", at: "get", text: "" },
      { ...GOT, op: 2 },
    ],
    { model: { tag: "downloading", done: 0, after: undefined } },
    ["download", "check", "download"],
  ],
  [
    "判定に失敗した後に判定が終わると、元の文を消す",
    [FP16, run, BROKE, run, ...judged],
    { error: "" },
    ["judge", "judge"],
  ],
  [
    "取るのに失敗した後に取り終えると、元の文を消す",
    [
      NONE,
      { type: "press", at: "get", text: "" },
      { type: "failed", did: "download", name: "TypeError", error: "x" },
      NONE,
      { type: "press", at: "get", text: "" },
      GOT,
    ],
    { error: "", note: undefined },
    ["download", "check", "download"],
  ],
  [
    "開いたときの確かめに失敗しても、判定するの横に何も出さない",
    [{ type: "failed", did: "check", name: "Error", error: "x" }],
    { note: undefined, error: "x", model: { tag: "absent" } },
    [],
  ],
  [
    "結果の面で判定し直すと、新しい結果まで前の結果を見せる",
    [...RESULT, run2],
    (s) =>
      s.pane.tag === "result" &&
      s.model.tag === "present" &&
      s.model.judge.tag === "loading",
    ["judge", "judge"],
  ],
  [
    "文章を貼り直すで入力欄の面に替え、入力欄に今の文章を入れる",
    [...RESULT, raw],
    { pane: expect.objectContaining({ tag: "raw", last: expect.anything() }) },
    ["judge", "fill"],
  ],
  [
    "入力欄の面から判定し直すと、終わったら結果の面になる",
    [...RESULT, raw, run2, ...judged],
    {
      pane: expect.objectContaining({
        tag: "result",
        last: expect.objectContaining({ text: run2.text }),
      }),
    },
    ["judge", "fill", "judge"],
  ],
  [
    "結果に戻ると、入力欄で変えた分を捨てて前の結果を出す",
    [...RESULT, raw, back],
    {
      pane: expect.objectContaining({
        tag: "result",
        last: expect.objectContaining({ text: TEXT }),
      }),
    },
    ["judge", "fill", "fill"],
  ],
  [
    "文章が空なら、開いたファイルを聞かずに入力欄に入れる",
    [FP16, picked("")],
    { ask: undefined, pane: expect.objectContaining({ tag: "raw" }) },
    ["fill"],
  ],
  [
    "文章があれば置き換えを確かめ、まだ入れない",
    [...RESULT, picked(TEXT)],
    {
      ask: { tag: "swap", name: "a.md", text: "ファイルの文。" },
      pane: expect.objectContaining({ tag: "result" }),
    },
    ["judge"],
  ],
  [
    "置き換えを選ぶと、結果の面からも入力欄の面に替えて入れる",
    [...RESULT, picked(TEXT), { type: "answer", yes: true }],
    { ask: undefined, pane: expect.objectContaining({ tag: "raw" }) },
    ["judge", "fill"],
  ],
  [
    "置き換えをやめると何も変えない",
    [...RESULT, picked(TEXT), { type: "answer", yes: false }],
    { ask: undefined, pane: expect.objectContaining({ tag: "result" }) },
    ["judge"],
  ],
  [
    "削除を確かめて消すと「削除しました」が出る",
    [
      FP16,
      del,
      { type: "measured", bytes: 2 ** 20 },
      { type: "answer", yes: true },
      { type: "cleared" },
    ],
    {
      model: { tag: "absent" },
      stored: 0,
      note: { at: "del", text: "削除しました" },
      ask: undefined,
    },
    ["measure", "clear"],
  ],
  [
    "削除に失敗すると、理由を出して確かめ直す",
    [
      FP16,
      del,
      { type: "measured", bytes: 1 },
      { type: "answer", yes: true },
      { type: "failed", did: "clear", name: "Error", error: "x" },
    ],
    {
      note: { at: "del", text: "削除できませんでした。もう一度押してください" },
      error: "x",
    },
    ["measure", "clear", "check"],
  ],
  [
    "削除に失敗しても確かめ直して何も無ければ、失敗の文を消す",
    [
      FP16,
      del,
      { type: "measured", bytes: 1 },
      { type: "answer", yes: true },
      { type: "failed", did: "clear", name: "Error", error: "x" },
      NONE,
    ],
    { note: undefined, error: "" },
    ["measure", "clear", "check"],
  ],
  [
    "削除に失敗して確かめ直すとまだ残っていれば、失敗の文を残す",
    [
      FP16,
      del,
      { type: "measured", bytes: 1 },
      { type: "answer", yes: true },
      { type: "failed", did: "clear", name: "Error", error: "x" },
      FP16,
    ],
    {
      note: { at: "del", text: "削除できませんでした。もう一度押してください" },
      error: "x",
    },
    ["measure", "clear", "check"],
  ],
  [
    "削除を測る間に開いたダウンロードの確かめは、測り終えても削除の確かめに替わらない",
    [
      FP16,
      { type: "variant", variant: "q8" },
      FP16,
      del,
      run,
      { type: "measured", bytes: 1 },
    ],
    {
      ask: { tag: "download", job: expect.anything() },
      note: { at: "del", text: "先に確かめに答えてください" },
    },
    ["check", "measure"],
  ],
  [
    "測って 0 バイトなら欄を開かない",
    [FP16, del, { type: "measured", bytes: 0 }],
    {
      ask: undefined,
      stored: 0,
      note: { at: "del", text: "削除するモデルはありません" },
    },
    ["measure"],
  ],
  [
    "開いたときに片方だけ保存されていれば、その版で始める",
    [{ ...NONE, missing: { fp16: SIZES.fp16, q8: 0 } }],
    { variant: "q8" },
    [],
  ],
])("%s", (_, events, want, did) => {
  const got = play(events);
  if (typeof want === "function") expect(want(got.state)).toBe(true);
  else expect(got.state).toMatchObject(want);
  expect(got.did).toEqual(did);
});

test.each<[string, Effect]>([
  ["文章を貼り直す", { do: "fill", op: 2, text: TEXT }],
  ["置き換え", { do: "fill", op: 2, text: "ファイルの文。" }],
])("%s で入力欄に入れる文", (what, want) => {
  const tail =
    what === "置き換え" ? [picked(TEXT), { type: "answer", yes: true }] : [raw];
  expect(play([...RESULT, ...tail] as Loose<Event>[]).run.at(-1)).toEqual(want);
});

const ASK = "先に確かめに答えてください";
test.each<[string, Loose<Event>[], Loose<Event>, string]>([
  ["空の文章", [FP16], { ...run, text: "" }, "先に文章を貼ってください"],
  [
    "空白だけの文章",
    [FP16],
    { ...run, text: " \n\t" },
    "先に文章を貼ってください",
  ],
  [
    "見出しだけの文章",
    [FP16],
    { ...run, text: "# 見出し\n" },
    "見出しだけでは判定できません。文を 2 つ以上貼ってください",
  ],
  [
    "ダウンロードだけの途中",
    [NONE, { type: "press", at: "get", text: "" }],
    run,
    "ダウンロードが終わると判定できます",
  ],
  [
    "ダウンロードして判定の途中",
    [NONE, run, { type: "answer", yes: true }],
    run,
    "ダウンロードが終わるとそのまま判定します",
  ],
  ["判定の途中", [FP16, run], run, "判定の途中です"],
  ["確かめの途中", [], run, "確かめています"],
  [
    "保存済みでダウンロード",
    [FP16],
    { type: "press", at: "fetch", text: "" },
    "ダウンロード済みです",
  ],
  ["何も無いのに削除", [NONE], del, "削除するモデルはありません"],
  [
    "置き換えの確かめの間に結果に戻る",
    [...RESULT, raw, picked(TEXT)],
    back,
    ASK,
  ],
  ["置き換えの確かめの間に貼り直す", [...RESULT, picked(TEXT)], raw, ASK],
  [
    "ダウンロードの確かめの間に削除",
    [{ ...NONE, stored: 30e6 }, run],
    del,
    ASK,
  ],
  [
    "削除の確かめの間に判定",
    [FP16, del, { type: "measured", bytes: 1 }],
    run,
    ASK,
  ],
  [
    "削除の確かめの間にファイルを開く",
    [FP16, del, { type: "measured", bytes: 1 }],
    { type: "press", at: "open", text: "" },
    ASK,
  ],
  ["判定の途中に結果から貼り直す", [...RESULT, run2], raw, "判定の途中です"],
  [
    "ダウンロードの途中に貼り直す",
    [
      ...RESULT,
      { type: "variant", variant: "q8" },
      FP16,
      { type: "press", at: "fetch", text: "" },
    ],
    raw,
    "ダウンロードの途中です",
  ],
  [
    "入力欄から判定している間に結果に戻る",
    [...RESULT, raw, run2],
    back,
    "判定の途中です",
  ],
  [
    "入力欄から判定している間にファイルを開く",
    [FP16, run],
    { type: "press", at: "open", text: "" },
    "判定の途中です",
  ],
])(
  "%s で押すと、理由を押したボタンの横に出し、面は替えない",
  (_, before, e, text) => {
    const was = play(before).state.pane.tag;
    const got = play([...before, e]);
    expect(got.state.note).toEqual({ at: (e as { at: string }).at, text });
    expect(got.state.pane.tag).toBe(was);
  },
);

test("確かめの間にファイルを落とすと、開くの横に先に答えるよう出し、確かめは替えない", () => {
  const got = play([NONE, run, picked("")]);
  expect(got.state.note).toEqual({ at: "open", text: ASK });
  expect(got.state.ask?.tag).toBe("download");
  expect(got.did).toEqual([]);
});

test("ファイルを開くを押すと、ファイルを選ぶ", () => {
  expect(play([FP16, { type: "press", at: "open", text: "" }]).did).toEqual([
    "pick",
  ]);
});

test.each([
  [4, false, "q8"],
  [8, false, "fp16"],
  [undefined, false, "fp16"],
  [16, true, "q8"],
] as const)("メモリ %s GiB・スマホ %s なら %s を選ぶ", (memory, mobile, v) => {
  expect(pickVariant({ memory, mobile })).toBe(v);
});

test.each([
  [0, 10, 0, 0, ""],
  [2, 102, 0, 800, "あと約 40 秒"],
  [1, 2, 0, 59000, "あと約 59 秒"],
  [1, 2, 0, 60000, "あと約 1 分"],
  [1, 3, 0, 61000, "あと約 3 分"],
  [5, 5, 0, 100, ""],
])(
  "%i / %i 組を %i〜%i ms で終えたら「%s」",
  (done, total, since, at, want) => {
    expect(eta(done, total, since, at)).toBe(want);
  },
);

test.each([
  [
    "download",
    "QuotaExceededError",
    "この端末では保存できませんでした。シークレットウィンドウでは容量が足りないことがあります",
  ],
  ["judge", "Error", "判定できませんでした。もう一度押してください"],
  ["clear", "Error", "削除できませんでした。もう一度押してください"],
] as const)("%s が %s で失敗したら「%s」", (did, name, want) => {
  expect(words(did, name)).toBe(want);
});

test.each([
  [SIZES.fp16, "約 710 MB"],
  [SIZES.q8, "約 520 MB"],
  [SIZES.fp16 + Q8_MODEL, "約 1.2 GB"],
  [7, "約 1 MB"],
  [3.2e6, "約 3 MB"],
  [994e6, "約 990 MB"],
  [996e6, "約 1.0 GB"],
])("%i バイトは「%s」", (bytes, want) => {
  expect(about(bytes)).toBe(want);
});

const NO_ACT = {
  resume: false,
  dismiss: false,
  light: false,
  retry: false,
  err: true,
};
const JUDGE_STALL =
  "判定が途中で止まりました。この端末のメモリが足りないと止まることがあります。軽量のモデルに替えると動くことがあります。";
const removal = (what: string) =>
  `${what}をこの端末から削除します。次に判定するときに、またダウンロードします。`;
test.each<[string, Loose<Event>[], Partial<ReturnType<typeof view>>]>([
  [
    "開いたばかりで何も無い",
    [NONE],
    {
      pane: "raw",
      run: "判定する",
      dock: true,
      saved: false,
      get: true,
      kept: "",
      lack: "",
    },
  ],
  [
    "ダウンロード中",
    [
      NONE,
      { type: "press", at: "get", text: "" },
      { type: "bytes", done: 100e6 },
    ],
    {
      status: "モデルをダウンロードしています",
      count: "100 MB / 約 710 MB",
      stop: true,
      locked: true,
      frozen: false,
    },
  ],
  [
    "入力欄から判定の準備",
    [FP16, run],
    {
      status: "判定の準備をしています",
      count: "",
      bar: "wait",
      frozen: true,
    },
  ],
  [
    "判定の途中",
    [FP16, run, { type: "opened", at: 0 }],
    { status: "判定しています", count: "0 / 1", bar: { value: 0, max: 1 } },
  ],
  [
    "ダウンロードの確かめ(軽量)は判定の帯に出す",
    [{ type: "variant", variant: "q8" }, { ...NONE, op: 2 }, run],
    {
      ask: {
        text: "初回だけ約 520 MB のモデル(軽量)をダウンロードします。この端末に保存し、文章は送りません。",
        yes: "ダウンロードして判定",
        danger: false,
        at: "dock",
      },
      frozen: true,
    },
  ],
  [
    "標準を保存した後の軽量の確かめは、足りない分だけで「初回だけ」を付けない",
    [FP16, { type: "variant", variant: "q8" }, { ...FP16, op: 2 }, run],
    {
      ask: expect.objectContaining({
        text: "軽量のモデル(約 520 MB)のうち、まだ無い約 480 MB をダウンロードします。この端末に保存し、文章は送りません。",
      }),
      kept: "この端末に保存済み: 標準(約 710 MB)",
      lack: "軽量はまだダウンロードしていません",
      get: false,
    },
  ],
  [
    "取り終えた数は、残りの大きさと同じ丸めで右を超えない",
    [
      FP16,
      { type: "variant", variant: "q8" },
      { ...FP16, op: 2 },
      { type: "press", at: "fetch", text: "" },
      { type: "bytes", done: SIZES.q8 },
    ],
    { count: "480 MB / 約 480 MB" },
  ],
  [
    "結果の面は、判定し直す文が無ければ判定の帯を出さない",
    [...RESULT],
    {
      pane: "result",
      run: "判定し直す",
      dock: false,
      again: "",
      saved: true,
    },
  ],
  [
    "標準の結果を見たまま軽量に替えた",
    [...RESULT, { type: "variant", variant: "q8" }, BOTH],
    {
      mark: "標準で判定した結果です",
      dock: true,
      again: "判定し直す文が 1 文あります",
      slot: "判定し直す(1 文)",
      tech: "fp16・wasm で 1 文を判定しました(4 ms、1 組 4.0 ms)",
    },
  ],
  [
    "版を戻して判定し直す文が 0 でも、版の印があれば判定し直すを出す",
    [
      ...RESULT,
      { type: "variant", variant: "q8" },
      BOTH,
      run,
      ...judged,
      { type: "variant", variant: "fp16" },
      BOTH,
    ],
    { mark: "軽量で判定した結果です", again: "", slot: "判定し直す" },
  ],
  [
    "入力欄の面に替えたら、前の結果があれば判定し直すと書く",
    [...RESULT, raw],
    { pane: "raw", run: "判定し直す", dock: true, slot: "" },
  ],
  [
    "結果の面でモデルを消した",
    [...DELETED],
    { pane: "result", get: true, kept: "", lack: "" },
  ],
  [
    "1 つのモデルの削除の確かめは設定の中に出す",
    [FP16, del, { type: "measured", bytes: SIZES.fp16 }],
    {
      kept: "この端末に保存済み: 標準(約 710 MB)",
      ask: {
        text: removal("標準(約 710 MB)"),
        yes: "削除する",
        danger: true,
        at: "set",
      },
    },
  ],
  [
    "2 つのモデルの削除の確かめ",
    [BOTH, del, { type: "measured", bytes: BOTH.stored }],
    {
      kept: "この端末に保存済み: 標準と軽量(約 1.2 GB)",
      ask: expect.objectContaining({
        text: removal("標準と軽量(合わせて約 1.2 GB)"),
      }),
    },
  ],
  [
    "前の revision の箱だけの削除の確かめ",
    [{ ...NONE, stored: 30e6 }, del, { type: "measured", bytes: 30e6 }],
    {
      kept: "この端末に保存済み: 約 30 MB",
      ask: expect.objectContaining({
        text: removal("保存したモデル(約 30 MB)"),
      }),
    },
  ],
  [
    "入力欄の面で置き換えを確かめている間は入力欄を読むだけにする",
    [FP16, picked(TEXT)],
    { frozen: true, ask: expect.objectContaining({ at: "top" }) },
  ],
  ["止まっていなければ知らせは無い", [...RESULT], { stall: undefined }],
  [
    "中止した後の知らせ",
    [NONE, { type: "press", at: "get", text: "" }, STOPPED],
    {
      stall: {
        ...NO_ACT,
        text: "ダウンロードを止めました。",
        resume: true,
        err: false,
      },
    },
  ],
  [
    "取るのに失敗した後の知らせ",
    [NONE, { type: "press", at: "get", text: "" }, LOST],
    {
      stall: {
        ...NO_ACT,
        text: "ダウンロードが途中で止まりました。もう一度押すと、取れた所の続きから取ります。",
        resume: true,
        dismiss: true,
        err: true,
      },
    },
  ],
  [
    "標準で判定に失敗した後の知らせ",
    [FP16, run, BROKE],
    {
      stall: {
        ...NO_ACT,
        text: JUDGE_STALL,
        light: true,
        retry: true,
        err: true,
      },
    },
  ],
  [
    "軽量で判定に失敗した後の知らせには、軽量に替えるを出さない",
    [{ type: "variant", variant: "q8" }, { ...BOTH, op: 2 }, run, BROKE],
    { stall: { ...NO_ACT, text: JUDGE_STALL, retry: true, err: true } },
  ],
  [
    "置き換えの確かめは列の上に出す",
    [...RESULT, picked(TEXT)],
    {
      ask: {
        text: "今の文章を「a.md」の中身に置き換えますか",
        yes: "置き換える",
        danger: false,
        at: "top",
      },
    },
  ],
])("画面: %s", (_, events, want) => {
  expect(view(play(events).state)).toMatchObject(want);
});

test.each<[string, Loose<Event>[], boolean]>([
  ["開いた直後の確かめの間", [], false],
  ["何も保存していない", [NONE], true],
  [
    "取っている間",
    [NONE, { type: "press", at: "get", text: "" }, { type: "bytes", done: 1 }],
    true,
  ],
  ["取り終えた", [NONE, { type: "press", at: "get", text: "" }, GOT], false],
  [
    "選んでいない版だけ保存している",
    [FP16, { type: "variant", variant: "q8" }, { ...FP16, op: 2 }],
    false,
  ],
  ["削除した", [...DELETED], true],
])("保存した版が 1 つも無いと分かっているか: %s", (_, events, bare) => {
  expect(view(play(events).state).bare).toBe(bare);
});

const LONG = "一つ目の文だ。二つ目の文だ。\n三つ目の文だ。\n\n四つ目の文だ。";
const long = (text: string) => ({ ...run, text });
const ROUND = [
  FP16,
  long(LONG),
  { type: "opened", at: 0 },
  { type: "judged", ps: [0.2, 0.5, 0.8], on: "wasm", at: 3 },
] as const;
const EDITED = LONG.replace("三つ目の文だ。", "三つ目の文だよ。");
const lastOf = (s: State) => {
  if (!s.pane.last) throw new Error("結果が無い");
  return s.pane.last;
};

test("文を直して判定し直すと、変わった組だけを判定に回し、その数を分母にする", () => {
  const got = play([...ROUND, raw, long(EDITED), { type: "opened", at: 10 }]);
  const judge = got.run.at(-1);
  expect(judge?.do === "judge" && judge.boundaries.map((b) => b.next)).toEqual([
    "三つ目の文だよ。",
    "四つ目の文だ。",
  ]);
  expect(view(got.state)).toMatchObject({
    count: "0 / 2",
    bar: { value: 0, max: 2 },
  });
});

test("全部の組が取り置きにあれば、判定に回さずに結果の面にする", () => {
  const got = play([...ROUND, raw, long(LONG)]);
  expect(got.did).toEqual(["judge", "fill"]);
  expect(got.state.pane.tag).toBe("result");
  expect(got.state.model).toEqual({ tag: "present", judge: { tag: "idle" } });
  expect(view(got.state).tech).toBe(
    "fp16 で 3 文のうち 0 文を判定し直しました",
  );
});

test.each([
  ["全部の組が取り置きにあれば、確かめずに結果を出す", run, undefined, 0],
  ["取り置きに無い組があれば、ダウンロードを確かめる", run2, "download", 1],
])("モデルを削除した後: %s", (_, press, ask, judged) => {
  const { state } = play([...DELETED, press]);
  expect(state.ask?.tag).toBe(ask);
  expect(lastOf(state).judged).toBe(judged);
  expect(state.model.tag).toBe("absent");
});

test.each<[string, Loose<Event>[], (number | undefined)[]]>([
  [
    "組が合い、鍵の変わった行に前の数を付ける(2 桁が同じでも)",
    [
      long(EDITED),
      { type: "opened", at: 0 },
      { type: "judged", ps: [0.6, 0.801], on: "wasm", at: 1 },
    ],
    [undefined, 0.5, 0.8],
  ],
  [
    "足した行には付けない",
    [
      long(LONG.replace("二つ目", "新しい文だ。二つ目")),
      { type: "opened", at: 0 },
      { type: "judged", ps: [0.9, 0.9, 0.9], on: "wasm", at: 1 },
    ],
    [undefined, 0.2, 0.5, undefined],
  ],
  [
    "版を替えた後は付けない",
    [
      { type: "variant", variant: "q8" },
      { ...FP16, missing: { fp16: 0, q8: 0 } },
      long(EDITED),
      { type: "opened", at: 0 },
      { type: "judged", ps: [0.9, 0.9, 0.9], on: "wasm", at: 1 },
    ],
    [undefined, undefined, undefined],
  ],
])("%s", (_, events, want) => {
  const rows = lastOf(play([...ROUND, raw, ...events]).state).rows;
  expect(rows.map((r) => r.was)).toEqual(want);
});

test("初めての結果は位置を持たない(開いたときにいちばん低い文を選ぶ)", () => {
  expect(play([...ROUND]).state.pane.seen).toBeUndefined();
});

test("入力欄の面から判定し直すと、選んだ文が消えたら後ろの文を選び、その文には前の数を付けない", () => {
  const seen = { cur: 1, mode: "low", top: { i: 2, dy: -5 } } as const;
  const after = play([
    ...ROUND,
    { type: "seen", seen },
    raw,
    long(LONG.replace("三つ目の文だ。\n", "")),
    { type: "opened", at: 0 },
    { type: "judged", ps: [0.4], on: "wasm", at: 1 },
  ]).state;
  expect(after.pane.seen).toEqual({
    cur: 1,
    mode: "low",
    top: { i: 1, dy: -5 },
  });
  expect(lastOf(after).rows.map((r) => r.was)).toEqual([undefined, undefined]);
});

test("選んでいた文を書き替えて判定し直すと、その文を選んだまま前の数を付ける", () => {
  const seen = { cur: 1, mode: "doc", top: null } as const;
  const after = play([
    ...ROUND,
    { type: "seen", seen },
    raw,
    long(EDITED),
    { type: "opened", at: 0 },
    { type: "judged", ps: [0.6, 0.8], on: "wasm", at: 1 },
  ]).state;
  expect(after.pane.seen?.cur).toBe(1);
  expect(lastOf(after).rows[1].was).toBe(0.5);
});

test.each([
  ["結果にある番号なら持つ", 1, null, true],
  ["結果に無い選んだ文は捨てる", 3, null, false],
  ["結果に無い見ていた文は捨てる", 0, 3, false],
])("位置の知らせ: %s", (_, cur, top, kept) => {
  const s = play([...ROUND]).state;
  const seen = {
    cur,
    mode: "doc",
    top: top === null ? null : { i: top, dy: 0 },
  } as const;
  expect(next(s, { type: "seen", seen }).state.pane.seen).toEqual(
    kept ? seen : undefined,
  );
});

test("変わった組だけを判定したときは、判定した数と 1 組の時間をその数で出す", () => {
  const got = play([
    ...ROUND,
    raw,
    long(EDITED),
    { type: "opened", at: 10 },
    { type: "judged", ps: [0.6, 0.8], on: "wasm", at: 16 },
  ]);
  expect(view(got.state).tech).toBe(
    "fp16・wasm で 3 文のうち 2 文を判定し直しました(6 ms、1 組 3.0 ms)",
  );
});

const AT3 = LONG.indexOf("三つ目の文だ。");
const fix = (text: string, from = AT3, to = AT3 + "三つ目の文だ。".length) =>
  ({ type: "fix", from, to, text }) as const;
const ps = (s: State) => shown(s).rows.map((r) => r.p);

test.each<[string, Loose<Event>[], string | undefined, (number | null)[]]>([
  [
    "本文の中で直すと、その範囲だけを置き換え、鍵の変わった組を未判定にする",
    [...ROUND, fix("三つ目の文だよ。")],
    EDITED,
    [0.2, null, null],
  ],
  [
    "変えずに決めると文章を変えない",
    [...ROUND, fix("三つ目の文だ。")],
    undefined,
    [0.2, 0.5, 0.8],
  ],
  [
    "前に判定した形に戻すと、取り置きの数をすぐ出す",
    [
      ...ROUND,
      fix("三つ目の文だよ。"),
      fix("三つ目の文だ。", AT3, AT3 + "三つ目の文だよ。".length),
    ],
    undefined,
    [0.2, 0.5, 0.8],
  ],
  [
    "判定の間に直すと、直した文章を残し、取り置きだけが増える",
    [
      ...ROUND,
      fix("三つ目の文だよ。"),
      long(EDITED),
      { type: "opened", at: 10 },
      fix("三つ目の文だね。", AT3, AT3 + "三つ目の文だよ。".length),
      { type: "judged", ps: [0.6, 0.7], on: "wasm", at: 16 },
    ],
    LONG.replace("三つ目の文だ。", "三つ目の文だね。"),
    [0.2, null, null],
  ],
  [
    "判定の間に元の文章へ戻すと、判定した文章で上書きしない",
    [
      ...ROUND,
      fix("三つ目の文だよ。"),
      long(EDITED),
      { type: "opened", at: 10 },
      fix("三つ目の文だ。", AT3, AT3 + "三つ目の文だよ。".length),
      { type: "judged", ps: [0.6, 0.7], on: "wasm", at: 16 },
    ],
    undefined,
    [0.2, 0.5, 0.8],
  ],
])("直す: %s", (_, events, draft, want) => {
  const s = play(events).state;
  expect(s.pane.tag === "result" && s.pane.draft).toBe(draft ?? undefined);
  expect(ps(s)).toEqual(want);
});

test.each([
  ["箇条", ["- **項目の**一つです。次の文です。", "- 項目の二つです。"]],
  ["引用", ["前の文です。", "", "> 引用の文です。次の文です。"]],
  [
    "表",
    [
      "| 列 | 列 |",
      "|---|---|",
      "| 表の文です。 | 次の文です。 |",
      "",
      "後の文です。続きの文です。",
    ],
  ],
  ["続きの行", ["括弧の中で（行を", "  折った）文です。次の文です。"]],
])(
  "lay の範囲を書き替えて元の文字列に戻すと、元の文章に戻る(%s、LF と CRLF)",
  (_, ls) => {
    for (const nl of ["\n", "\r\n"]) {
      const md = ls.join(nl);
      const n = parse(md, false).boundaries.length;
      const base = play([
        FP16,
        long(md),
        { type: "opened", at: 0 },
        { type: "judged", ps: Array(n).fill(0.5), on: "wasm", at: 1 },
      ]).state;
      for (const l of lay(md, shown(base).rows)) {
        if (l.t !== "s") continue;
        const was = md.slice(l.from, l.to);
        const s = next(base, fix("直した。", l.from, l.to)).state;
        expect(shown(s).text).not.toBe(md);
        const back = next(s, fix(was, l.from, l.from + "直した。".length));
        expect(back.state.pane.draft).toBeUndefined();
        expect(shown(back.state).text).toBe(md);
      }
    }
  },
);

test("直した文章を判定し直すと、それが新しい結果になり、差と選んでいた文が残る", () => {
  const got = play([
    ...ROUND,
    { type: "seen", seen: { cur: 1, mode: "low", top: null } },
    fix("三つ目の文だよ。"),
    long(EDITED),
    { type: "opened", at: 10 },
    { type: "judged", ps: [0.6, 0.7], on: "wasm", at: 16 },
  ]).state;
  expect(got.pane).toMatchObject({
    tag: "result",
    draft: undefined,
    seen: { cur: 1 },
    last: { text: EDITED },
  });
  expect(lastOf(got).rows.map((r) => r.was)).toEqual([undefined, 0.5, 0.8]);
  expect(view(got).again).toBe("");
});

test("直した後の本文は、鍵の変わらない行に前の回との差を残す", () => {
  const s = play([
    ...ROUND,
    raw,
    long(EDITED),
    { type: "opened", at: 10 },
    { type: "judged", ps: [0.6, 0.7], on: "wasm", at: 16 },
    fix("一つ目の文だね。", 0, "一つ目の文だ。".length),
  ]).state;
  expect(shown(s).rows.map((r) => r.was)).toEqual([undefined, undefined, 0.8]);
});

test("直した後の判定し直す文の数は、直した文章で数える", () => {
  expect(view(play([...ROUND, fix("三つ目の文だよ。")]).state)).toMatchObject({
    dock: true,
    again: "判定し直す文が 2 文あります",
    slot: "判定し直す(2 文)",
  });
});

test.each([
  ["文章を貼り直すは、直した文章を入力欄に入れる", [raw], EDITED],
  ["結果に戻ると、直した文章のまま本文に戻る", [raw, back], EDITED],
])("%s", (_, tail, want) => {
  const got = play([...ROUND, fix("三つ目の文だよ。"), ...tail]);
  expect(got.run.at(-1)).toEqual({ do: "fill", op: got.state.op, text: want });
});
