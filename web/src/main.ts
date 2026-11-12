import { parse } from "../../src/markdown.ts";
import {
  type At,
  view as cells,
  client,
  doc,
  type Line,
  lay,
  type Mark,
  summary,
} from "../../src/sheet.ts";
import { readPicked } from "./file.ts";
import {
  about,
  backendFor,
  type Effect,
  type Event,
  next,
  SPOTS,
  type Spot,
  type State,
  type Step,
  shown,
  start,
  type View,
  view,
} from "./flow.ts";
import {
  type Backend,
  GpuError,
  gpuGaps,
  type Judge,
  openJudge,
} from "./infer.ts";
import * as keep from "./keep.ts";
import sample from "./sample.json" with { type: "json" };
import {
  clear,
  download,
  load,
  missing,
  SIZES,
  savedBytes,
  type Variant,
} from "./store.ts";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const app = $<HTMLDivElement>("app");
const col = $<HTMLDivElement>("col");
const md = $<HTMLTextAreaElement>("md");
const lines = $<HTMLDivElement>("lines");
const inBox = $<HTMLElement>("in");
const inNote = $<HTMLParagraphElement>("in-note");
const docEl = $<HTMLElement>("doc");
const side = $<HTMLElement>("side");
const more = $<HTMLDetailsElement>("more");
const run = $<HTMLButtonElement>("run");
const stop = $<HTMLButtonElement>("stop");
const bar = $<HTMLProgressElement>("bar");
const status = $<HTMLSpanElement>("status");
const ask = $<HTMLDivElement>("ask");
const stall = $<HTMLDivElement>("stall");
const stallActs = {
  resume: $("resume"),
  dismiss: $("dismiss"),
  light: $("light"),
  retry: $("retry"),
};
const no = $<HTMLButtonElement>("no");
const yes = $<HTMLButtonElement>("yes");
const file = $<HTMLInputElement>("file");
const keepBox = $<HTMLInputElement>("keep");
const copy = $<HTMLButtonElement>("copy");
const copyNote = $<HTMLSpanElement>("copy-note");
const copyLabel = $<HTMLSpanElement>("copy-label");
const setButton = $<HTMLButtonElement>("set");
const radios = [
  ...document.querySelectorAll<HTMLInputElement>('input[name="variant"]'),
];
const buttons = Object.fromEntries(SPOTS.map((at) => [at, $(at)])) as Record<
  Spot,
  HTMLButtonElement
>;
const places = { dock: $("dock-ask"), set: $("set-ask"), top: $("top") };
const again = document.createElement("button");
again.type = "button";
again.className = "tg-btn sm pri";
const T = client();
const O = { bert: true };
const narrow = matchMedia("(max-width:959px)");
const WAIT =
  '<p class="wait">判定すると、ここに選んだ文と低い順の一覧が出ます。</p>';
const EG: Mark[] = parse(sample.text, false).boundaries.map((b, i) => ({
  ...b,
  p: sample.ps[i],
}));
// 最初の画面に入る文のうち、いちばん低い文を選んで見せる
const EG_AT = EG.slice(0, 12).reduce(
  (a, r, i) => ((r.p ?? 1) < (EG[a].p ?? 1) ? i : a),
  0,
);
for (const v of ["fp16", "q8"] as const)
  $(`size-${v}`).textContent = ` ${about(SIZES[v])}`;

const box = (() => {
  try {
    return localStorage;
  } catch {}
})();
$("keep-row").hidden = !(box && keep.usable(box));
const restored = box && keep.read(box);
if (restored !== undefined) md.value = restored;
keepBox.checked = restored !== undefined;

const query = new URLSearchParams(location.search);
const asked = query.get("backend");
const threads =
  Number(query.get("threads")) || Math.min(16, navigator.hardwareConcurrency);
// docs/design/web.md「backend の選び方」参照
const gaps: Record<Variant, string | undefined> =
  asked === "wasm" ? { fp16: undefined, q8: undefined } : await gpuGaps();
let marked = false;
/** ?backend=webgpu のときは替えない。測る道なので失敗を見せる */
function offGpu(why: unknown) {
  if (asked === "webgpu") return false;
  console.warn("GPU をやめて wasm で判定します", why);
  gaps.fp16 = gaps.q8 = String(why);
  // 書いた印を残して、次に開いたときも wasm にする
  marked = false;
  return true;
}
if (box && keep.gpuTrying(box, Date.now()))
  offGpu("前の GPU の判定が途中で止まりました");
function markGpu() {
  if (!box) return;
  keep.markGpu(box, Date.now());
  marked = true;
}
/** このページが書いた印だけ消す */
function unmarkGpu() {
  if (!box || !marked) return;
  keep.unmarkGpu(box);
  marked = false;
}
addEventListener("pagehide", unmarkGpu);

type Last = NonNullable<State["pane"]["last"]>;
let state: State;
let judge: { variant: Variant; on: Backend; judge: Judge } | undefined;
let halt: AbortController | undefined;
type Drawn = { last: Last; draft: string | undefined; memo: State["memo"] };
/** 本文と右の欄に描いているもの。handle は mount したまま操作を受けている間だけ */
let drawn: Drawn | "sample" | "wait" | undefined;
let handle: ReturnType<typeof T.mount> | undefined;
let laid: Line[] = [];
/** 本文の中で直している行。開くのは 1 つだけ */
let editing:
  | { i: number; row: HTMLElement; html: string; marks: string[] }
  | undefined;
let sentences = 0;
let bare = false;

const current = () => (state.pane.tag === "raw" ? md.value : shown(state).text);

// docs/design/web.md「ページ」参照
function draw(text: string, rows: readonly Mark[], at: At, fix = false) {
  handle?.destroy();
  laid = lay(text, rows);
  const D = cells(rows, undefined, laid);
  docEl.innerHTML = doc(laid, D);
  side.innerHTML = T.side(D, O, null, "low");
  side.querySelector(".tg-slot")?.append(again);
  // 別の行を選んだら、開いていた直す欄はやめた扱いにする
  const select = (j: number | null) => {
    if (!editing || editing.i === j) return;
    // 待たせていた描き直しで、押した行の選びを失わないよう先に控える
    remember();
    close(true);
  };
  handle = T.mount(app, D, O, at, fix ? { fix: edit, select } : {});
}

// docs/design/web.md「判定し直し」参照
function edit(i: number) {
  close();
  const l = laid.find((l) => l.t === "s" && l.i === i);
  const row = docEl.querySelector<HTMLElement>(`[data-i="${i}"]`);
  const t = row?.querySelector<HTMLElement>(".t");
  if (l?.t !== "s" || !row || !t) return;
  editing = {
    i,
    row,
    html: t.innerHTML,
    marks: ["w", "y"].filter((c) => row.classList.contains(c)),
  };
  row.classList.remove("w", "y");
  row.classList.add("ed");
  document.body.toggleAttribute("data-editing", true);
  t.innerHTML = `<div class="edit"><textarea aria-label="${l.no} 番の文を直す"></textarea><div class="acts"><button type="button" class="tg-btn sm pri">決める</button><button type="button" class="tg-btn sm">やめる</button><span><kbd>Enter</kbd> で決める<span class="esc">・<kbd>Esc</kbd> でやめる</span></span></div></div>`;
  const area = t.querySelector("textarea") as HTMLTextAreaElement;
  const [ok, cancel] = t.querySelectorAll("button");
  const fit = () => {
    if (CSS.supports("field-sizing", "content")) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };
  const decide = () => {
    close();
    act({ type: "fix", from: l.from, to: l.to, text: area.value });
    store();
    refocus();
  };
  const quit = () => {
    close(true);
    refocus();
  };
  // 枠の中のクリックを mount に渡さない(行を選び直さない)
  (t.firstElementChild as HTMLElement).onclick = (e) => e.stopPropagation();
  area.value = current().slice(l.from, l.to);
  area.oninput = fit;
  area.onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      return quit();
    }
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229)
      return;
    e.preventDefault();
    decide();
  };
  ok.onclick = decide;
  cancel.onclick = quit;
  fit();
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}

/** 直す欄を閉じて行を戻す。redraw なら待たせていた描き直しをする */
function close(redraw = false) {
  if (!editing) return;
  const { row, html, marks } = editing;
  editing = undefined;
  document.body.removeAttribute("data-editing");
  row.classList.remove("ed");
  row.classList.add(...marks);
  (row.querySelector(".t") as HTMLElement).innerHTML = html;
  if (redraw) set(view(state));
}
/** 閉じた後のフォーカス。未判定のカードには「この文を直す」が無いので、判定し直すへ */
const refocus = () =>
  (
    side.querySelector<HTMLElement>('[data-act="fix"]') ??
    (narrow.matches ? again : run)
  ).focus();

function show(eg: boolean) {
  const p = state.pane;
  if (p.tag === "result") {
    // 直す欄を開いている間は、決めるかやめるまで描き直さない
    if (editing) return;
    const d = drawn;
    if (
      handle &&
      typeof d === "object" &&
      d.last === p.last &&
      d.draft === p.draft &&
      d.memo === state.memo
    )
      return;
    drawn = { last: p.last, draft: p.draft, memo: state.memo };
    const { text, rows } = shown(state);
    return draw(text, rows, p.seen ?? {}, true);
  }
  close();
  if (eg) {
    if (drawn === "sample") return;
    drawn = "sample";
    const y = col.scrollTop;
    draw(sample.text, EG, { cur: EG_AT });
    col.scrollTop = y;
    return;
  }
  handle?.destroy();
  handle = undefined;
  if (p.last || drawn === "wait") return;
  drawn = "wait";
  docEl.innerHTML = "";
  side.innerHTML = WAIT;
}

function set(v: View) {
  const had = document.activeElement;
  const result = v.pane === "result";
  const eg = !result && !v.back && md.value === "";
  document.body.dataset.pane = v.pane;
  document.body.toggleAttribute("data-eg", eg);
  inBox.hidden = result;
  $("hint").hidden = !v.back;
  $("eg-head").hidden = !eg;
  docEl.hidden = !(result || eg);
  show(eg);
  md.readOnly = v.frozen;
  buttons.raw.hidden = !result;
  buttons.back.hidden = !v.back;
  copy.hidden = !result;
  if (!result) copyNote.textContent = "";
  $("sum").innerHTML = result ? summary(shown(state).rows, true) : "";
  run.textContent = v.run;
  $("go").hidden = !v.dock;
  $("meta").textContent = result ? v.again : sentences ? `${sentences} 文` : "";
  $("mark").textContent = v.mark;
  again.textContent = v.slot;
  again.hidden = !v.slot;
  for (const at of SPOTS) buttons[at].ariaDisabled = String(v.off[at]);
  for (const at of SPOTS) {
    const note = $(`${at}-note`);
    if (note.textContent !== v.notes[at]) note.textContent = v.notes[at];
  }
  $("set-mark").hidden = v.saved;
  for (const r of radios) {
    r.checked = r.value === v.variant;
    r.disabled = v.locked;
  }
  $("none-row").hidden = !v.get;
  $("kept-row").hidden = !v.kept;
  $("kept").textContent = v.kept;
  $("lack-row").hidden = !v.lack;
  $("lack").textContent = v.lack;
  $("tech").textContent = v.tech;
  $("error").textContent = v.error;
  $("prog").hidden = v.bar === undefined;
  if (v.bar === "wait") bar.removeAttribute("value");
  else if (v.bar) [bar.value, bar.max] = [v.bar.value, v.bar.max];
  bar.ariaLabel = v.status;
  bar.ariaValueText = v.count;
  if (status.textContent !== v.status) status.textContent = v.status;
  $("count").textContent = v.count;
  stop.hidden = !v.stop;
  const showAsk = v.ask !== undefined && ask.hidden;
  if (v.ask) {
    $("ask-text").textContent = v.ask.text;
    yes.textContent = v.ask.yes;
    const sm = v.ask.at === "set" ? " sm" : "";
    yes.className = `tg-btn${sm}${v.ask.danger ? "" : " pri"}`;
    no.className = `tg-btn${sm}`;
    const place = places[v.ask.at];
    if (ask.parentElement !== place) place.append(ask);
    if (v.ask.at === "set") more.open = true;
  }
  ask.hidden = !v.ask;
  const showStall = v.stall !== undefined && stall.hidden;
  stall.hidden = !v.stall;
  if (v.stall) {
    const text = $("stall-text");
    if (text.textContent !== v.stall.text) text.textContent = v.stall.text;
    for (const [k, b] of Object.entries(stallActs))
      b.hidden = !v.stall[k as keyof typeof stallActs];
    stall.classList.toggle("err", v.stall.err);
    stallActs.resume.classList.toggle("pri", v.stall.err);
  }
  const notice =
    v.bar !== undefined ||
    v.ask?.at === "dock" ||
    v.notes.run !== "" ||
    v.stall !== undefined;
  document.body.toggleAttribute("data-notice", notice);
  const none = v.bare && !notice;
  document.body.toggleAttribute("data-none", none);
  $("dock").hidden = !v.dock && !notice;
  $("none-set").hidden = $("none-dock").hidden = !none;
  // docs/design/web.md「ページ」参照
  if (!narrow.matches && v.bare !== bare) more.open = v.bare;
  bare = v.bare;
  if (showAsk) no.focus();
  else if (had instanceof HTMLElement && had.closest("[hidden]")) {
    // 中止を押して隠れたら、止まった知らせの最初のボタンへ
    if (showStall)
      stall.querySelector<HTMLElement>("button:not([hidden])")?.focus();
    else if (!result) md.focus();
    else (had as HTMLElement).blur();
  }
}

const dispatch = (e: Event) => apply(next(state, e));
/** 本文を描き直しうる操作の前に、見ていた所を控える */
function remember() {
  if (handle && typeof drawn === "object")
    dispatch({ type: "seen", seen: handle.seen() });
}
const act = (e: Event) => {
  remember();
  dispatch(e);
};
function apply(step: Step) {
  state = step.state;
  set(view(state));
  for (const f of step.run)
    perform(f).catch((e: unknown) =>
      dispatch({
        type: "failed",
        op: f.op,
        did: f.do,
        name: e instanceof Error ? e.name : "",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
}

// docs/design/web.md「判定し直し」参照
function number() {
  const ls = md.value.split("\n");
  while (lines.childElementCount > ls.length) lines.lastElementChild?.remove();
  while (lines.childElementCount < ls.length)
    lines.append(document.createElement("div"));
  ls.forEach((l, k) => {
    const row = lines.children[k];
    // 空の行も 1 行の高さを持たせる
    const t = l || " ";
    if (row.textContent !== t) row.textContent = t;
  });
  lines.scrollTop = md.scrollTop;
}

async function drop() {
  const old = judge;
  judge = undefined;
  await old?.judge.release();
}

// docs/design/web.md「backend の選び方」参照
function open(variant: Variant) {
  const on = backendFor(gaps[variant], asked);
  if (on === "webgpu") markGpu();
  // ORT の proxy が重みを worker に渡すので、開き直すたびに読む
  const start = async (b: Backend) => ({
    variant,
    on: b,
    judge: await openJudge(await load(variant), b, threads),
  });
  return start(on).catch((e: unknown) => {
    if (!(e instanceof GpuError) || !offGpu(e)) {
      unmarkGpu();
      throw e;
    }
    return start("wasm").catch(() => {
      throw e;
    });
  });
}

async function look() {
  const [fp16, q8, stored] = await Promise.all([
    missing("fp16"),
    missing("q8"),
    savedBytes(),
  ]);
  return { missing: { fp16, q8 }, stored };
}

async function perform(f: Effect): Promise<void> {
  switch (f.do) {
    case "check":
      return dispatch({ type: "checked", op: f.op, ...(await look()) });
    case "download": {
      const h = new AbortController();
      halt = h;
      void navigator.storage.persist();
      let stopped = false;
      try {
        await download(
          f.variant,
          (done) => dispatch({ type: "bytes", op: f.op, done }),
          h.signal,
        );
      } catch (e) {
        if (!h.signal.aborted) throw e;
        stopped = true;
      }
      return dispatch({
        type: "fetched",
        op: f.op,
        stopped,
        ...(await look()),
      });
    }
    case "stop":
      return halt?.abort();
    case "judge": {
      let on: Backend = "wasm";
      const attempt = async () => {
        if (judge?.variant !== f.variant) {
          await drop();
          judge = await open(f.variant);
        }
        on = judge.on;
        if (on === "webgpu") markGpu();
        dispatch({ type: "opened", op: f.op, at: performance.now() });
        return judge.judge
          .run(f.boundaries, (done) =>
            dispatch({ type: "step", op: f.op, done, at: performance.now() }),
          )
          .catch(async (e: unknown) => {
            // 途中で止まったセッションを使い回さず、もう一度判定では開き直す
            await drop().catch(() => {});
            throw e;
          });
      };
      const ps = await attempt()
        .catch((e: unknown) => {
          if (on !== "webgpu" || !(e instanceof GpuError) || !offGpu(e))
            throw e;
          return attempt();
        })
        .finally(unmarkGpu);
      remember();
      return dispatch({
        type: "judged",
        op: f.op,
        ps,
        on,
        at: performance.now(),
      });
    }
    case "measure":
      return dispatch({
        type: "measured",
        op: f.op,
        bytes: await savedBytes(),
      });
    case "clear":
      await drop();
      await clear();
      return dispatch({ type: "cleared", op: f.op });
    case "fill":
      md.value = f.text;
      say("");
      typed();
      if (state.pane.tag === "raw") md.focus();
      return;
    case "pick":
      return file.click();
  }
}

function typed() {
  number();
  sentences = parse(md.value, false).sentences.length;
  store();
  set(view(state));
}
/** 今の文章をこの端末に残す */
function store() {
  if (box && !keep.save(box, keepBox.checked, current()))
    unkeep("この端末に残せませんでした");
}
function say(text: string, bad = false) {
  inNote.textContent = text;
  inNote.classList.toggle("bad", bad);
}
function unkeep(why: string) {
  if (box) keep.forget(box);
  keepBox.checked = false;
  say(why, true);
}
async function take(f: File) {
  const r = await readPicked(f);
  if ("why" in r) return say(r.why, true);
  act({ type: "picked", name: f.name, text: r.text, now: current() });
}

let undo = 0;
// docs/design/web.md「入口」参照
function copied(ok: boolean) {
  copyNote.textContent = ok
    ? "コピーしました"
    : "コピーできませんでした。文章を選んでコピーしてください";
  copyNote.classList.toggle("vh", ok);
  copyLabel.textContent = ok ? "コピーしました" : "全文をコピー";
  clearTimeout(undo);
  if (ok)
    undo = window.setTimeout(() => {
      copyLabel.textContent = "全文をコピー";
      copyNote.textContent = "";
    }, 2000);
}
copy.onclick = () => {
  const t = current();
  const old = () => {
    const a = document.createElement("textarea");
    a.value = t;
    a.style.cssText = "position:fixed;opacity:0";
    document.body.append(a);
    a.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    a.remove();
    copied(ok);
  };
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(t))
    .then(() => copied(true), old);
};

for (const at of SPOTS)
  buttons[at].onclick = () => act({ type: "press", at, text: current() });
again.onclick = () => act({ type: "press", at: "run", text: current() });
md.oninput = () => {
  if (inNote.classList.contains("bad")) say("");
  typed();
};
file.onchange = () => {
  const f = file.files?.[0];
  file.value = "";
  if (f) void take(f);
};
keepBox.onchange = () => {
  if (!keepBox.checked) return unkeep("");
  say("");
  typed();
};
window.addEventListener("storage", (e) => {
  if (e.storageArea === box && keep.forgotten(e)) unkeep("");
});
const carriesFiles = (e: DragEvent) =>
  e.dataTransfer?.types.includes("Files") ?? false;
window.addEventListener("dragover", (e) => {
  if (carriesFiles(e)) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (carriesFiles(e)) e.preventDefault();
});
col.ondragover = (e) => {
  if (carriesFiles(e)) col.classList.add("drop");
};
col.ondragleave = (e) => {
  if (!col.contains(e.relatedTarget as Node | null))
    col.classList.remove("drop");
};
col.ondrop = (e) => {
  col.classList.remove("drop");
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  e.preventDefault();
  void take(f);
};
md.onscroll = () => {
  lines.scrollTop = md.scrollTop;
};
stop.onclick = () => dispatch({ type: "stop" });
stallActs.resume.onclick = () => act({ type: "resume", text: current() });
stallActs.light.onclick = () => {
  void drop();
  act({ type: "light", text: current() });
};
stallActs.retry.onclick = () =>
  act({ type: "press", at: "run", text: current() });
stallActs.dismiss.onclick = () => dispatch({ type: "dismiss" });
for (const r of radios)
  r.onchange = () => {
    // docs/design/web.md「ページ」参照
    void drop();
    dispatch({ type: "variant", variant: r.value as Variant });
  };
yes.onclick = () => act({ type: "answer", yes: true });
no.onclick = () => act({ type: "answer", yes: false });
ask.onkeydown = (e) => {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  act({ type: "answer", yes: false });
};
setButton.onclick = () => {
  more.open = !more.open;
};
// 幅が替わったら、モデルが無い間の開き方を幅に合わせ直す
narrow.onchange = () => {
  if (bare) more.open = !narrow.matches;
  set(view(state));
};
$("open-set").onclick = () => {
  more.open = true;
  more.querySelector<HTMLElement>("input:checked")?.focus();
};
$("close-set").onclick = () => {
  more.open = false;
  setButton.focus();
};
more.ontoggle = () => {
  setButton.ariaExpanded = String(more.open);
};
more.onkeydown = (e) => {
  if (e.key !== "Escape" || !narrow.matches) return;
  e.stopPropagation();
  more.open = false;
  setButton.focus();
};
// docs/design/web.md「ページ」参照
new ResizeObserver(() => {
  const h = narrow.matches ? side.offsetHeight : 0;
  app.style.setProperty("--tg-sb", `${h}px`);
  // 高くなったシートの裏に、選んだ文の数を隠さない
  const on = h ? docEl.querySelector(".tg-row.on") : null;
  if (on && T.sunk(on, side)) on.scrollIntoView({ block: "start" });
}).observe(side);

number();
sentences = parse(md.value, false).sentences.length;
apply(
  start({
    memory: (navigator as { deviceMemory?: number }).deviceMemory,
    mobile: matchMedia("(pointer: coarse)").matches,
  }),
);
