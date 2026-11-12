import type { Boundary, Kind } from "./markdown.ts";
import { starts } from "./page.ts";

/** p が null の境目は未判定。was は前の回の p */
export type Mark = Boundary & { p: number | null; was?: number };
/** ブラウザへ渡す境目 1 つ。no は本文の文の番号、hide は足切りで落ちた境目 */
export type Cell = {
  no: number;
  line: number;
  kind: Kind;
  before: string;
  prev: string;
  next: string;
  copy?: string;
  p: number | null;
  was?: number;
  hide?: true;
};
export type Line =
  | { t: "title" | "h" | "code" | "aside"; text: string }
  | { t: "gap" }
  | {
      t: "s";
      no: number;
      text: string;
      i: number | null;
      li: boolean;
      /** 元の文章での範囲 [from, to)。続きの行をまとめた行は複数行にまたがる */
      from: number;
      to: number;
    };
export type Opts = { bert: boolean; fix?: boolean };
export type Order = "doc" | "low";
export type At = {
  cur?: number | null;
  mode?: Order;
  top?: { i: number; dy: number } | null;
};
export type Hooks = {
  select?(i: number | null): void;
  order?(mode: Order): void;
  fix?(i: number): void;
};

/** 本文の 1 文 1 行。docs/design/cli.md「--html」参照 */
export function lay(text: string, rows: readonly Mark[]): Line[] {
  const raws = text.split(/\r\n?|\n/);
  const base = [0];
  for (const m of text.matchAll(/\r\n?|\n/g)) base.push(m.index + m[0].length);
  // raws[n] の [a, b) の前後の空白を除いた、元の文章での範囲
  const span = (n: number, a: number, b: number) => {
    const s = raws[n].slice(a, b);
    const lo = a + s.length - s.trimStart().length;
    const hi = a + s.trimEnd().length;
    return { from: base[n] + lo, to: base[n] + Math.max(lo, hi) };
  };
  const at = starts(text, rows);
  const by = new Map<number, { at: number; i: number }[]>();
  for (const [i, { line }] of rows.entries())
    by.set(line, [...(by.get(line) ?? []), { at: at[i], i }]);
  const out: Line[] = [];
  let no = 0;
  let fence = false;
  let front =
    raws[0]?.trim() === "---" &&
    raws.some((l, j) => j > 0 && l.trim() === "---");
  let note = false;
  let open = false;
  const push = (l: Line) => {
    open = l.t === "s";
    const last = out.at(-1)?.t;
    if (l.t !== "gap" || (last && !["gap", "title", "h"].includes(last)))
      out.push(l);
  };
  // 文でない行は 1 行ずつ、文の行は null を返して下で切る
  const plain = (raw: string, n: number): Line | "skip" | null => {
    if (front) {
      if (n > 0 && raw.trim() === "---") front = false;
      return { t: "aside", text: raw };
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      open = false;
      return "skip";
    }
    if (fence) return { t: "code", text: raw };
    if (note || /^\s*<!-{2}/.test(raw)) {
      note = !raw.includes("-->");
      return { t: "aside", text: raw.trim() };
    }
    if (!raw.trim()) return { t: "gap" };
    const h = /^(#{1,6})\s+(.*)$/.exec(raw.trim());
    if (h)
      return {
        t: h[1] === "#" && !out.some((l) => l.t !== "aside") ? "title" : "h",
        text: h[2].trim(),
      };
    if (
      /^\s*:::|^\s*\|[\s:|-]+$|^\s*([-*_])(\s*\1){2,}\s*$|^\s*!\[[^\]]*\]\([^)]*\)\s*$|^\s*<?https?:\/\/\S+>?\s*$/.test(
        raw,
      )
    )
      return { t: "aside", text: raw.trim() };
    return null;
  };
  for (const [n, raw] of raws.entries()) {
    const l = plain(raw, n);
    if (l === "skip") continue;
    if (l) {
      push(l);
      continue;
    }
    const li = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(raw);
    const lead = (li ?? /^\s*(?:>\s*)*/.exec(raw))?.[0].length ?? 0;
    // starts は md の記号を飛ばした位置を返すので、文の頭の記号を文に戻す
    const ms = (by.get(n + 1) ?? [])
      .map(({ at, i }) => {
        let a = Math.max(at, lead);
        while (a > lead && /[*_`[~]/.test(raw[a - 1])) a--;
        return { at: a, i };
      })
      .sort((a, b) => a.at - b.at);
    const end = ms[0]?.at ?? raw.length;
    let head = raw.slice(lead, end).trim();
    let pre = "";
    if (ms.length && /^[\p{P}\p{S}\s]*$/u.test(head)) [pre, head] = [head, ""];
    const last = out.at(-1);
    const cont = open && !li && !/^\s*\|/.test(raw) && last?.t === "s";
    const h = span(n, lead, end);
    if (head && cont) {
      last.text += head;
      last.to = h.to;
    } else if (head)
      push({ t: "s", no: ++no, text: head, i: null, li: !!li, ...h });
    for (const [k, { at, i }] of ms.entries()) {
      const r = span(n, at, ms[k + 1]?.at ?? raw.length);
      push({
        t: "s",
        no: ++no,
        text: (k ? "" : pre && `${pre} `).concat(
          raw.slice(r.from - base[n], r.to - base[n]),
        ),
        i,
        li: !!li && !head && k === 0,
        from: k === 0 && pre ? h.from : r.from,
        to: r.to,
      });
    }
  }
  if (out.at(-1)?.t === "gap") out.pop();
  return out;
}

export function view(
  rows: readonly Mark[],
  shown: readonly boolean[] = rows.map(() => true),
  lines: readonly Line[] = [],
): Cell[] {
  const nos = new Map(
    lines.flatMap((l) => (l.t === "s" && l.i !== null ? [[l.i, l.no]] : [])),
  );
  return rows.map((r, i) => ({
    no: nos.get(i) ?? i + 1,
    line: r.line,
    kind: r.kind,
    before: r.before,
    prev: r.prev,
    next: r.next,
    ...(r.nextWritten === undefined ? {} : { copy: r.nextWritten }),
    p: r.p,
    ...(r.was === undefined ? {} : { was: r.was }),
    ...(shown[i] ? {} : { hide: true as const }),
  }));
}

const C = client();

/** .tg-doc の中身 */
export function doc(lines: readonly Line[], D: readonly Cell[]): string {
  let gap = false;
  return lines
    .map((l) => {
      const pb = gap;
      gap = l.t === "gap";
      if (l.t === "gap") return "";
      if (l.t === "title") return `<h1 class="tg-title">${C.esc(l.text)}</h1>`;
      if (l.t === "h") return `<h2 class="tg-h">${C.esc(l.text)}</h2>`;
      if (l.t !== "s")
        return `<div class="tg-${l.t}${pb ? " pb" : ""}">${C.esc(l.text)}</div>`;
      const c = l.i === null ? undefined : D[l.i];
      const live = c && !c.hide;
      const cls = [
        "tg-row",
        live && c.p !== null ? C.cls(c.p) : "",
        pb ? "pb" : "",
        l.li ? "li" : "",
      ].filter(Boolean);
      const m = !c || c.hide ? "" : C.margin(c);
      return `<div class="${cls.join(" ")}"${live ? ` data-i="${l.i}"` : ""}><span class="no">${l.no}</span><span class="t">${C.esc(l.text)}</span><span class="m">${m}</span></div>`;
    })
    .join("");
}

/** 上の帯の要約。未判定を除くすべての境目を数える */
export const summary = (rows: readonly Mark[], bert: boolean) =>
  C.sum(view(rows), bert);

/** 右の欄・操作。中から外の名前を参照しない(CLI が toString で埋め込む。docs/design/cli.md「--html」) */
export function client() {
  const BAND = [0.45, 0.87];
  const esc = (s: string) =>
    s.replace(
      /[&<>"]/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
    );
  const q = (p: number) => Number(p.toFixed(2));
  const f2 = (p: number) => p.toFixed(2);
  const cls = (p: number) => (q(p) < 0.2 ? "w" : q(p) < 0.5 ? "y" : "");
  const cents = (p: number) => Math.round(q(p) * 100);
  const delta = (c: Cell) =>
    c.was === undefined || c.p === null ? null : cents(c.p) - cents(c.was);
  const tone = (d: number) => (Math.abs(d) < 5 ? "eq" : d > 0 ? "up" : "dn");
  const signed = (d: number) =>
    (d < 0 ? "−" : "+") + (Math.abs(d) / 100).toFixed(2);
  const moved = (was: number, p: number) => {
    const d = cents(p) - cents(was);
    return d === 0
      ? `${f2(was)} から(変わらず)`
      : `${f2(was)} → ${f2(p)}(<span class="${tone(d)}">${signed(d)}</span>)`;
  };
  const head = (open: boolean, mode: Order) =>
    open ? "閉じる" : `${mode === "low" ? "低い順" : "出てくる順"}の一覧`;
  const judged = (D: readonly Cell[]) =>
    D.flatMap((c) => (c.p === null ? [] : [c.p]));
  const bins = (D: readonly Cell[]) => {
    const n = Array<number>(10).fill(0);
    for (const p of judged(D)) n[Math.min(9, Math.floor(cents(p) / 10))]++;
    return n;
  };
  const under = (D: readonly Cell[]) => judged(D).filter((p) => q(p) < 0.5);
  const sum = (D: readonly Cell[], bert: boolean) =>
    `判定した ${judged(D).length} 文のうち <b>0.5 未満 ${under(D).length} 文</b>${bert ? "(ふつうの記事は 3 割ほど)" : ""}`;
  const order = (D: readonly Cell[], mode: Order) => {
    const ids = D.flatMap((c, i) => (c.hide || c.p === null ? [] : [i]));
    return mode === "low"
      ? ids.sort((a, b) => q(D[a].p as number) - q(D[b].p as number) || a - b)
      : ids;
  };
  /** 開いたときに選ぶ文。undefined はいちばん低い文、null は選ばない */
  const first = (D: readonly Cell[], cur: number | null | undefined) => {
    const low = order(D, "low");
    return cur === null
      ? null
      : cur !== undefined && (low.includes(cur) || D[cur]?.p === null)
        ? cur
        : (low[0] ?? null);
  };
  const go = (ord: readonly number[], cur: number | null, d: number) => {
    if (!ord.length) return null;
    const k = cur === null ? -1 : ord.indexOf(cur);
    if (k < 0) return d > 0 ? ord[0] : (ord.at(-1) as number);
    return ord[Math.min(ord.length - 1, Math.max(0, k + d))];
  };
  const margin = (c: Cell) => {
    if (c.p === null) return '<span class="pend">未判定</span>';
    const d = delta(c);
    const mark =
      d !== null && Math.abs(d) >= 5
        ? `<span class="d ${d > 0 ? "up" : "dn"}">${d > 0 ? "▲" : "▼"}</span>`
        : "";
    return `<span class="v">${f2(c.p)}</span>${mark}`;
  };
  const card = (D: readonly Cell[], o: Opts, i: number | null, mode: Order) => {
    const c = i === null ? undefined : D[i];
    if (!c)
      return '<div class="empty">文を押すと、前の文とのつながりの数がここに出ます。</div>';
    if (c.p === null)
      return `<div class="k">${c.no} 番の文</div><div class="empty">この文は直した後まだ判定していません。判定し直すと数が出ます。</div>`;
    const ord = order(D, mode);
    const low = order(D, "low");
    const k = ord.indexOf(i as number);
    const range = o.bert
      ? `<span class="rg">ふつうの記事の範囲${q(c.p) < BAND[0] ? "より低い" : q(c.p) > BAND[1] ? "より高い" : "の中"}</span>`
      : "";
    const big = D.flatMap((x, j) => {
      const d = delta(x);
      return j !== i && !x.hide && d !== null && Math.abs(d) >= 5 ? [j] : [];
    }).sort(
      (a, b) =>
        Math.abs(delta(D[b]) as number) - Math.abs(delta(D[a]) as number),
    );
    const other = big.length
      ? `<div class="other">ほかに大きく変わった文: <button class="tg-link" data-go="${big[0]}">${D[big[0]].no} 番 ${f2(D[big[0]].was as number)} → ${f2(D[big[0]].p as number)}(${signed(delta(D[big[0]]) as number)})</button></div>`
      : "";
    const dis = (b: boolean) => (b ? ' aria-disabled="true"' : "");
    return `<div class="k">${c.no} 番の文・行 ${c.line} ・ 前の文からのつながり</div><div class="score"><span class="big${q(c.p) < 0.5 ? " lo" : ""}">${f2(c.p)}</span><span class="rank">低い方から ${low.indexOf(i as number) + 1} 番目${range}</span></div><div class="diff">${c.was === undefined ? "" : moved(c.was, c.p)}</div><div class="pair">${o.bert && c.before ? `<div class="pp">${esc(c.before)}</div>` : ""}<div class="prev">${esc(c.prev)}</div><div class="cur ${cls(c.p)}">${esc(c.next)}</div></div><div class="acts"><button class="tg-btn ic" data-act="prev" aria-label="前の文"${dis(k <= 0)}><svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4"/></svg></button><button class="tg-btn ic" data-act="next" aria-label="次の文"${dis(k >= ord.length - 1)}><svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button>${o.fix ? '<button class="tg-btn" data-act="fix"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"/></svg>この文を直す</button>' : ""}<button class="tg-btn" data-act="copy" aria-label="この文をコピー"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>コピー</button><span class="cnote" role="status"></span></div>${other}`;
  };
  const dist = (D: readonly Cell[], o: Opts) => {
    const n = bins(D);
    const top = Math.max(1, ...n);
    const W = 332;
    const H = 56;
    const bars = n
      .map((c, k) => {
        const h = Math.round((c / top) * (H - 4));
        return `<rect x="${((k * W) / 10 + 1).toFixed(1)}" y="${H - h}" width="${(W / 10 - 2).toFixed(1)}" height="${h}" class="${k < 5 ? "lo" : ""}"><title>${(k / 10).toFixed(1)}〜${((k + 1) / 10).toFixed(1)}: ${c} 文</title></rect>`;
      })
      .join("");
    const band = o.bert
      ? `<rect class="band" x="${BAND[0] * W}" y="0" width="${((BAND[1] - BAND[0]) * W).toFixed(1)}" height="${H}"></rect>`
      : "";
    const t = (x: number, s: string, a: string) =>
      `<text x="${x}" y="${H + 13}" text-anchor="${a}">${s}</text>`;
    return `<p><b>0.5 未満 ${under(D).length} 文</b> / 判定した ${judged(D).length} 文</p><svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="数の分布">${band}<line x1="0" y1="${H + 0.5}" x2="${W}" y2="${H + 0.5}"></line>${bars}${t(0, "0", "start")}${t(W / 2, "0.5", "middle")}${t(W, "1", "end")}</svg>${o.bert ? `<p class="fine">灰色の帯: ふつうの記事で真ん中の半分が入る範囲(${BAND[0]}〜${BAND[1]})</p>` : ""}`;
  };
  const list = (D: readonly Cell[], i: number | null, mode: Order) =>
    order(D, mode)
      .map((j) => {
        const c = D[j];
        const p = c.p as number;
        const d = delta(c);
        return `<button class="tg-li${j === i ? " on" : ""}" data-li="${j}"><span class="i">${c.no}</span><span class="n${q(p) < 0.5 ? " lo" : ""}">${f2(p)}</span><span class="x">${esc(c.next)}</span><span class="dd ${d ? tone(d) : ""}">${d ? signed(d) : ""}</span></button>`;
      })
      .join("");
  /** .tg-side の中身。.tg-slot は mount が書き換えない差し込み口 */
  const side = (D: readonly Cell[], o: Opts, i: number | null, mode: Order) =>
    `<div class="tg-sheet-h"><span class="k">選んだ文</span><span class="tg-slot"></span><button class="tg-btn sm" data-act="sheet">${head(false, mode)}</button></div><div class="tg-card">${card(D, o, i, mode)}</div><div class="tg-more"><div class="tg-dist">${dist(D, o)}</div><div class="tg-lh"><span class="k">${order(D, mode).length} 文</span><span class="tg-seg" role="group" aria-label="並べ方"><button data-sort="low" aria-pressed="${mode === "low"}">低い順</button><button data-sort="doc" aria-pressed="${mode === "doc"}">出てくる順</button></span></div><div class="tg-list">${list(D, i, mode)}</div></div>`;
  /** 行の数の文字がシートの上端より下か。.m の箱は行の下端まで伸びるので文字で測る */
  const sunk = (r: Element, sheet: Element) => {
    const num = document.createRange();
    num.selectNodeContents(r.querySelector(".m") ?? r);
    return (
      num.getBoundingClientRect().bottom > sheet.getBoundingClientRect().top
    );
  };

  /** frame の .tg-doc と .tg-side は先に描いておく。本文は描き直さない */
  function mount(
    frame: HTMLElement,
    D: readonly Cell[],
    o: Opts,
    at: At = {},
    hooks: Hooks = {},
  ) {
    const $ = (s: string) => frame.querySelector(s) as HTMLElement;
    const col = $(".tg-col");
    const sideEl = $(".tg-side");
    const narrow = matchMedia("(max-width:959px)");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("order");
    } catch {}
    let mode: Order = at.mode ?? (saved === "doc" ? "doc" : "low");
    let cur = first(D, at.cur);
    const oo = { ...o, fix: !!hooks.fix };
    let open = false;
    const row = (i: number) => $(`.tg-doc [data-i="${i}"]`);
    // 狭い画面では下のシートが本文の下半分を覆う
    const mid = (): ScrollLogicalPosition =>
      narrow.matches ? "start" : "center";
    // 閉じたシートは前の文の頭の側を隠すので、隠れた分があれば頭に「…」を出す
    function clip() {
      const pv = $(".tg-card .prev");
      if (!pv) return;
      const t = document.createRange();
      t.selectNodeContents(pv);
      pv.classList.toggle(
        "cut",
        t.getBoundingClientRect().height > pv.clientHeight + 1,
      );
    }
    // 隠れていたシートが出たときと、幅が変わって折り返しが変わったときに測り直す
    const fit = new ResizeObserver(clip);
    function paint() {
      for (const e of frame.querySelectorAll(".tg-doc .on"))
        e.classList.remove("on");
      if (cur !== null) row(cur)?.classList.add("on");
      $(".tg-card").innerHTML = card(D, oo, cur, mode);
      $(".tg-list").innerHTML = list(D, cur, mode);
      for (const b of frame.querySelectorAll("[data-sort]"))
        b.setAttribute(
          "aria-pressed",
          String((b as HTMLElement).dataset.sort === mode),
        );
      sideEl.classList.toggle("open", open);
      clip();
      $('[data-act="sheet"]').textContent = head(open, mode);
      frame.style.setProperty(
        "--tg-sb",
        narrow.matches ? `${sideEl.offsetHeight}px` : "0px",
      );
    }
    function select(i: number | null, from: "doc" | "list" | "key") {
      cur = i;
      paint();
      hooks.select?.(i);
      if (i === null) return;
      const r = row(i);
      // 本文で押した行も、下の段の数がシートに入るなら送る
      const under =
        narrow.matches && sideEl.offsetHeight > 0 && !!r && sunk(r, sideEl);
      if (from !== "doc" || under)
        r?.scrollIntoView({
          block: from === "key" || narrow.matches ? mid() : "nearest",
        });
      const L = $(".tg-list");
      L.querySelector(`[data-li="${i}"]`)?.scrollIntoView({ block: "nearest" });
      // docs/design/web.md「ページ」参照。設定を開いた広い組みは一覧が欄ごと動く
      if (
        from !== "list" &&
        !narrow.matches &&
        getComputedStyle(L).overflowY === "visible"
      )
        for (const s of [".tg-card", ".tg-card .score"])
          $(s)?.scrollIntoView({ block: "nearest" });
    }
    const step = (d: number) => {
      const n = go(order(D, mode), cur, d);
      if (n !== null) select(n, "key");
    };
    function copy(b: HTMLElement) {
      if (cur === null) return;
      const t = D[cur].copy ?? D[cur].next;
      const note = b.parentElement?.querySelector(".cnote");
      const done = (ok: boolean) => {
        if (note)
          note.textContent = ok
            ? "コピーしました"
            : "コピーできませんでした。文を選んでコピーしてください";
      };
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
        done(ok);
      };
      Promise.resolve()
        .then(() => navigator.clipboard.writeText(t))
        .then(() => done(true), old);
    }
    const onClick = (e: Event) => {
      const t = (e.target as HTMLElement).closest(
        "[data-i],[data-li],[data-act],[data-sort],[data-go]",
      ) as HTMLElement | null;
      if (!t || !frame.contains(t) || t.getAttribute("aria-disabled")) return;
      const v = t.dataset;
      if (v.sort) {
        mode = v.sort === "doc" ? "doc" : "low";
        try {
          localStorage.setItem("order", mode);
        } catch {}
        hooks.order?.(mode);
        return select(cur, "list");
      }
      if (v.go) return select(Number(v.go), "key");
      if (v.li) return select(Number(v.li), "list");
      if (v.act === "prev" || v.act === "next")
        return step(v.act === "next" ? 1 : -1);
      if (v.act === "copy") return copy(t);
      if (v.act === "fix") return cur !== null && hooks.fix?.(cur);
      if (v.act === "sheet") {
        open = !open;
        return paint();
      }
      if (v.i) select(Number(v.i), "doc");
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      if (t?.closest?.("input,textarea,select,[contenteditable]")) return;
      if (e.key === "ArrowDown" || e.key === "j") step(1);
      else if (e.key === "ArrowUp" || e.key === "k") step(-1);
      else if (e.key === "Escape") {
        if (open) {
          open = false;
          paint();
        } else select(null, "key");
      } else return;
      e.preventDefault();
    };
    frame.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    narrow.addEventListener("change", paint);
    paint();
    fit.observe(sideEl);
    const back = at.top ? row(at.top.i) : null;
    if (back && at.top)
      col.scrollTop += back.getBoundingClientRect().top - at.top.dy;
    else if (cur !== null) row(cur)?.scrollIntoView({ block: mid() });
    return {
      seen(): Required<At> {
        const top = col.getBoundingClientRect().top;
        const r = [...frame.querySelectorAll(".tg-doc [data-i]")].find(
          (x) => x.getBoundingClientRect().bottom > top,
        ) as HTMLElement | undefined;
        return {
          cur,
          mode,
          top: r
            ? {
                i: Number(r.dataset.i),
                dy: Math.round(r.getBoundingClientRect().top),
              }
            : null,
        };
      },
      destroy() {
        frame.removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKey);
        narrow.removeEventListener("change", paint);
        fit.disconnect();
      },
    };
  }
  return {
    esc,
    cls,
    moved,
    bins,
    sum,
    order,
    go,
    first,
    margin,
    card,
    dist,
    list,
    side,
    sunk,
    mount,
  };
}

/** 外枠 .tg の下に閉じた CSS。色と字は DESIGN.md の frontmatter */
export const SHEET_CSS = `
.tg{--paper:#fdfdfb;--paper-2:#f6f5f1;--paper-3:#eeede7;--field:#fff;--ink:#202020;--ink-2:#4f4d48;--ink-3:#686762;--rule:#e3e2dc;--rule-2:#cfcdc6;--shu:#d9381e;--shu-ink:#b42e18;--blue:#2b59c3;--blue-wash:rgb(43 89 195/.09);--up:#2f6b3a;--f-body:"Shippori Mincho","Hiragino Mincho ProN","Yu Mincho",serif;--f-ui:"Noto Sans JP","Hiragino Sans","Yu Gothic UI",system-ui,sans-serif;--ease:cubic-bezier(.23,1,.32,1);--gut:36px;--mar:64px;--padl:16px;--tg-sb:0px;display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;background:var(--paper);color:var(--ink);font:14px/1.6 var(--f-ui);color-scheme:light;-webkit-text-size-adjust:100%}
.tg *{box-sizing:border-box}
.tg ::selection{background:rgb(43 89 195/.2)}
:where(.tg button){font:inherit;color:inherit}
.tg :focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.tg-bar{display:flex;align-items:center;gap:16px;min-height:52px;padding:0 max(16px,env(safe-area-inset-right,0px)) 0 max(16px,env(safe-area-inset-left,0px));border-bottom:1px solid var(--rule);min-width:0}
.tg-brand{font:600 20px/1 var(--f-body);letter-spacing:.04em}
.tg-name{font-size:13px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:24em}
.tg-sum{font-size:13px;color:var(--ink-2);min-width:0}
.tg-sum b,.tg-meta b,.tg-dist p b{color:var(--shu-ink);font-weight:500}
.tg-meta{display:none;margin:0;padding:8px 12px 0 var(--padl);font-size:12px;color:var(--ink-2)}
.tg-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:500 14px/20px var(--f-ui);padding:8px 14px;border-radius:4px;border:1px solid var(--rule-2);background:var(--field);color:var(--ink);cursor:pointer;white-space:nowrap;transition:background-color .15s var(--ease),transform .12s var(--ease)}
.tg-btn:hover{background:var(--paper-3)}
.tg-btn:active{transform:scale(.97)}
.tg-btn.sm{padding:4px 10px;font-size:13px}
.tg-btn.ic{width:32px;height:32px;padding:0}
.tg-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.tg-btn[aria-disabled="true"]{color:var(--ink-3);background:var(--paper-2);cursor:default}
.tg-link{border:0;background:none;padding:0;color:var(--blue);text-decoration:underline;text-underline-offset:3px;cursor:pointer;font-size:12px;text-align:left}
.tg .cnote{font-size:12px;color:var(--ink-3)}
.tg .up{color:var(--up)}.tg .dn{color:var(--shu-ink)}.tg .eq{color:var(--ink-3)}
.tg-main{display:grid;grid-template-columns:minmax(0,1060px) minmax(380px,1fr);width:100%;max-width:1920px;margin-inline:auto;min-height:0}
@media (min-width:1921px){.tg-main>:first-child{border-left:1px solid var(--rule)}.tg-main>:last-child{border-right:1px solid var(--rule)}}
.tg-col{min-width:0;min-height:0;overflow:auto}
.tg-doc{padding:20px 0 calc(120px + var(--tg-sb))}
.tg-title{font:600 24px/1.5 var(--f-body);margin:4px 0 8px;padding:0 var(--mar) 0 calc(var(--padl) + var(--gut) + 12px);text-wrap:balance}
.tg-h{font:600 19px/1.5 var(--f-body);margin:36px 0 8px;padding-left:calc(var(--padl) + var(--gut) + 12px);text-wrap:balance}
.tg-row{display:grid;grid-template-columns:var(--gut) minmax(0,64em) var(--mar);column-gap:12px;padding:2px 12px 2px var(--padl);transition:background-color .12s var(--ease)}
.tg-row[data-i]{cursor:pointer}
.tg-row[data-i]:hover{background:rgb(32 32 32/.03)}
.tg-row.pb,.tg-code.pb,.tg-aside.pb{margin-top:16px}
.tg-row .no{font:500 12px/32px var(--f-ui);text-align:right;color:var(--ink-3);font-variant-numeric:tabular-nums;user-select:none}
.tg-row .t{font:400 17px/32px var(--f-body);position:relative;min-width:0;overflow-wrap:anywhere}
.tg-row .m{font:500 12px/32px var(--f-ui);font-variant-numeric:tabular-nums;color:var(--ink-3);white-space:nowrap;user-select:none}
.tg-row.li .t{padding-left:1.2em}
.tg-row.li .t::after{content:"・";position:absolute;left:0;top:0}
.tg-row.w .t{text-decoration:underline wavy var(--shu) 1.5px;text-underline-offset:7px;text-decoration-skip-ink:none}
.tg-row.y .t{text-decoration:underline solid var(--shu) 1px;text-underline-offset:7px;text-decoration-skip-ink:none}
.tg-row.w{padding-top:10px}
.tg-row.w .t::before{content:"∨";position:absolute;left:-12px;top:-11px;color:var(--shu);font:700 13px/1 var(--f-ui)}
.tg-row.w .m,.tg-row.y .m{color:var(--shu-ink)}
.tg-row.w .m .v{display:inline-block;border:1.5px solid var(--shu);border-radius:999px;padding:0 6px;line-height:20px;font-weight:600}
.tg-row.on{background:var(--blue-wash)}
.tg-row.on .no{color:var(--blue);font-weight:700}
.tg-row .d{margin-left:4px;font-size:11px}
.tg-row .pend{color:var(--blue);font-size:11px}
.tg-code,.tg-aside{margin-left:calc(var(--padl) + var(--gut) + 12px);margin-right:var(--mar);padding:0 12px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink-2)}
.tg-code{font:13px/1.7 ui-monospace,"SF Mono",Menlo,Consolas,monospace;background:var(--paper-2)}
.tg-aside{font-size:13px;line-height:1.8}
.tg-side{border-left:1px solid var(--rule);background:var(--paper-2);display:flex;flex-direction:column;min-height:0;overflow:hidden}
.tg-sheet-h{display:contents}
.tg-sheet-h>.k,.tg-sheet-h>[data-act="sheet"]{display:none}
.tg-card{padding:20px 24px 16px;border-bottom:1px solid var(--rule)}
.tg-card .k,.tg-card .rank,.tg-lh .k{font-size:12px;color:var(--ink-3)}
.tg-card .score{display:flex;align-items:baseline;gap:12px;margin:4px 0 2px}
.tg-card .big{font:600 40px/1.1 var(--f-body);font-variant-numeric:tabular-nums}
.tg-card .big.lo{color:var(--shu-ink)}
.tg-card .rg{display:block}
.tg-card .diff{font-size:13px;min-height:20px;font-variant-numeric:tabular-nums}
.tg-card .pair{margin:8px 0 12px;font:400 15px/1.9 var(--f-body);overflow-wrap:anywhere}
.tg-card .pp{color:var(--ink-3);font-size:13px}
.tg-card .prev{color:var(--ink-3)}
.tg-card .cur.w{text-decoration:underline wavy var(--shu) 1.5px;text-underline-offset:6px}
.tg-card .cur.y{text-decoration:underline solid var(--shu) 1px;text-underline-offset:6px}
.tg-card .acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tg-card .other{margin-top:12px;font-size:12px;color:var(--ink-3)}
.tg-card .empty{color:var(--ink-3);font-size:13px;padding:8px 0}
.tg-more{display:flex;flex-direction:column;min-height:0;flex:1}
.tg-dist{padding:12px 24px 8px;border-bottom:1px solid var(--rule)}
.tg-dist p{margin:0 0 4px;font-size:12px;color:var(--ink-2)}
.tg-dist .fine{margin:4px 0 0;color:var(--ink-3)}
.tg-dist svg{display:block;width:100%;max-width:332px;height:auto}
.tg-dist rect{fill:var(--rule-2)}.tg-dist rect.lo{fill:var(--shu);opacity:.75}.tg-dist rect.band{fill:var(--ink);opacity:.06}
.tg-dist line{stroke:var(--rule-2)}
.tg-dist text{font-size:10px;fill:var(--ink-3)}
.tg-lh{display:flex;align-items:center;justify-content:space-between;padding:8px 24px;gap:8px}
.tg-seg{display:inline-flex;border:1px solid var(--rule-2);border-radius:4px;overflow:hidden}
.tg-seg button{border:0;background:var(--field);padding:4px 10px;font-size:12px;cursor:pointer;color:var(--ink-2)}
.tg-seg button+button{border-left:1px solid var(--rule-2)}
.tg-seg button[aria-pressed="true"]{background:var(--ink);color:var(--paper)}
.tg-list{overflow:auto;min-height:0;flex:1;padding-bottom:24px}
.tg-li{display:grid;grid-template-columns:36px 40px minmax(0,1fr) 44px;gap:8px;align-items:center;padding:0 24px;height:32px;cursor:pointer;font-size:13px;border:0;background:none;width:100%;text-align:left}
.tg-li:hover{background:rgb(32 32 32/.04)}
.tg-li.on{background:var(--blue-wash)}
.tg-li .i{color:var(--ink-3);text-align:right;font-variant-numeric:tabular-nums;font-size:12px}
.tg-li .n{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.tg-li .n.lo{color:var(--shu-ink)}
.tg-li .x{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--f-body);font-size:14px}
.tg-li .dd{text-align:right;font-size:11px;font-variant-numeric:tabular-nums}
@media (max-width:959px){
.tg{--mar:0px;--padl:max(12px,env(safe-area-inset-left,0px))}
.tg-bar{min-height:48px;gap:8px}
.tg-brand{font-size:18px}
.tg-bar .tg-sum{display:none}
.tg-meta{display:block}
.tg-main{grid-template-columns:minmax(0,1fr)}
.tg-row{grid-template-columns:var(--gut) minmax(0,1fr);grid-template-areas:"no t" "m t";padding-right:max(12px,env(safe-area-inset-right,0px));align-content:start}
.tg-row .no{grid-area:no;line-height:30px}
.tg-row .t{grid-area:t;font-size:16px;line-height:30px}
.tg-row .m{grid-area:m;text-align:right;line-height:18px;font-size:11px}
.tg-row .m .d{display:none}
.tg-row.w .m .v{padding:0 4px;line-height:16px}
.tg-row.w .t::before{left:-10px}
.tg-title{font-size:20px;padding-right:16px}
.tg-code,.tg-aside{margin-right:12px}
.tg-side{position:fixed;left:0;right:0;bottom:0;z-index:20;max-height:52vh;border-left:0;border-top:1px solid var(--rule-2);border-radius:12px 12px 0 0;box-shadow:0 -4px 16px rgb(0 0 0/.08);padding-bottom:env(safe-area-inset-bottom,0px)}
.tg-side.open{max-height:78vh;overflow:auto}
.tg-side.open>*,.tg-side.open .tg-list{flex:none;overflow:visible}
.tg-side.open .tg-sheet-h{position:sticky;top:0;z-index:1;background:var(--paper-2);padding-bottom:8px}
.tg-row{scroll-margin-top:24px}
.tg-side:not(.open) .tg-more{display:none}
.tg-sheet-h{display:flex;align-items:center;gap:8px;padding:8px 16px 0}
.tg-sheet-h>.k,.tg-sheet-h>[data-act="sheet"]{display:revert}
.tg-sheet-h .k{font-size:12px;color:var(--ink-3);margin-right:auto}
.tg-card{padding:8px 16px 12px;border-bottom:0;overflow:auto}
.tg-card .big{font-size:28px}
.tg-card .rank{word-break:keep-all}
.tg-card .rg{display:inline}
.tg-card .rg::before{content:" ・ "}
.tg-card .pair{margin:4px 0 8px;font-size:14px;line-height:1.8}
.tg-side:not(.open) .tg-card .pp{display:none}
.tg-side:not(.open) .tg-card .diff:empty{display:none}
.tg-side:not(.open) .tg-card .prev{display:flex;flex-direction:column;justify-content:flex-end;max-height:calc(3*1.8em);overflow:hidden;position:relative}
.tg-side:not(.open) .tg-card .prev.cut::before{content:"…";position:absolute;top:0;left:0;padding-right:.6em;background:linear-gradient(to right,var(--paper-2) 60%,transparent)}
.tg-side.open .tg-card{border-bottom:1px solid var(--rule)}
.tg-dist,.tg-lh{padding-inline:16px}
.tg-dist svg{max-width:none}
.tg-li{padding:0 16px;grid-template-columns:32px 36px minmax(0,1fr) 40px}
}
@media (prefers-reduced-motion:reduce){.tg *{transition:none!important}}
`;
