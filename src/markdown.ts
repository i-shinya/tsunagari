export type Kind = "段落内" | "段落間" | "箇条へ" | "項目間" | "セル内";
export type Sentence = {
  text: string;
  line: number;
  heading: number;
  block: number;
  item: boolean;
};
/** at は next の、sentences での位置。before は prev の 1 つ前の文(無ければ "")。nextWritten は行の終わりに足した「。」を外した next(足していなければ無い) */
export type Boundary = {
  kind: Kind;
  line: number;
  heading: string;
  before: string;
  prev: string;
  next: string;
  nextWritten?: string;
  at: number;
};
export type Doc = {
  sentences: Sentence[];
  boundaries: Boundary[];
  headings: string[];
};

type Part = [line: number, text: string];
type Sent = [line: number, text: string, written?: string];
type Block = {
  sec: number;
  heading: number;
  kind: "para" | "item" | "cell";
  head: string;
  parts: Part[];
};

const END = "。！？!?";

const clean = (s: string) =>
  s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*|__|`/g, "")
    .trim();

// 括弧と鉤括弧の中の「。」では切らない
function splitSentences(buf: string): [start: number, text: string][] {
  const out: [number, string][] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if ("(（「『【".includes(c)) depth++;
    else if (")）」』】".includes(c)) depth = Math.max(0, depth - 1);
    else if (
      END.includes(c) &&
      depth === 0 &&
      !END.includes(buf[i + 1] ?? "")
    ) {
      out.push([start, buf.slice(start, i + 1).trim()]);
      start = i + 1;
    }
  }
  if (buf.slice(start).trim()) out.push([start, buf.slice(start).trim()]);
  return out;
}

function toSentences(parts: Part[]): Sent[] {
  let buf = "";
  const marks: [offset: number, line: number][] = [];
  const added = new Set<number>();
  for (const [line, t] of parts) {
    // 句点の無い行(項目の題など)は、行の終わりで文を切る
    if (buf && !END.includes(buf.at(-1) ?? "")) {
      added.add(buf.length);
      buf += "。";
    }
    marks.push([buf.length, line]);
    buf += clean(t);
  }
  return splitSentences(buf)
    .filter(([, s]) => s.length >= 4)
    .map(([start, s]) => {
      const at = buf.indexOf(s, start);
      const written = s.replace(/。/g, (c, k: number) =>
        added.has(at + k) ? "" : c,
      );
      return [
        Math.max(...marks.filter(([off]) => off <= start).map(([, l]) => l)),
        s,
        written === s ? undefined : written,
      ];
    });
}

function blocks(text: string): { blocks: Block[]; headings: string[] } {
  const lines = text.split(/\r\n?|\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === "---");
    i = end > 0 ? end + 1 : 0;
  }
  const out: Block[] = [];
  let cur: Block | null = null;
  let sec = 0;
  const headings: string[] = [];
  let head = "";
  let fence = false;
  let comment = false;
  const flush = () => {
    if (cur?.parts.length) out.push(cur);
    cur = null;
  };
  for (let n = i; n < lines.length; n++) {
    const raw = lines[n];
    let st = raw.trim();
    if (st.startsWith("```") || st.startsWith("~~~")) {
      fence = !fence;
      flush();
      continue;
    }
    if (fence) continue;
    // docs/design/cli.md「文と境目」参照
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(st)) {
      flush();
      continue;
    }
    if (comment || st.startsWith("<!--")) {
      comment = !st.includes("-->");
      flush();
      continue;
    }
    // リンクカード(URL だけの行、@[card](…))は本文に数えない
    if (
      !st ||
      /^:::/.test(st) ||
      /^(?:https?:\/\/\S+|@\[\w+\]\(.*\))$/.test(st)
    ) {
      flush();
      continue;
    }
    if (st.startsWith("|")) {
      flush();
      if (/^\|[\s:|-]+\|?$/.test(st)) continue;
      for (const cell of st.replace(/^\||\|$/g, "").split("|")) {
        const t = cell.trim().replace(/<br\s*\/?>/g, "");
        if (t)
          out.push({
            sec,
            heading: headings.length,
            kind: "cell",
            head,
            parts: [[n + 1, t]],
          });
      }
      continue;
    }
    const h = st.match(/^#{1,6}\s+(.*)/);
    if (h) {
      flush();
      sec++;
      head = clean(h[1]);
      headings.push(head);
      continue;
    }
    st = st.replace(/^>\s*/, "");
    const item = st.match(/^(?:[-*+]|\d+[.)])\s+(.*)/);
    if (item) {
      flush();
      cur = {
        sec,
        heading: headings.length,
        kind: "item",
        head,
        parts: [[n + 1, item[1]]],
      };
    } else if (cur) cur.parts.push([n + 1, st]);
    else
      cur = {
        sec,
        heading: headings.length,
        kind: "para",
        head,
        parts: [[n + 1, st]],
      };
  }
  flush();
  return { blocks: out, headings };
}

export function parse(markdown: string, includeLists: boolean): Doc {
  const { blocks: raw, headings } = blocks(markdown);
  const sentences: Sentence[] = [];
  const boundaries: Boundary[] = [];
  let prev: (Block & { sents: Sent[] }) | null = null;
  for (const [block, rb] of raw.entries()) {
    const b = { ...rb, sents: toSentences(rb.parts) };
    if (!b.sents.length) continue;
    const base = sentences.length;
    for (const [line, text] of b.sents)
      sentences.push({
        text,
        line,
        heading: b.heading,
        block,
        item: b.kind === "item",
      });
    const cell = b.kind === "cell";
    const joined = !cell && prev?.kind !== "cell" && prev?.sec === b.sec;
    if (joined && prev) {
      const both = b.kind === "item" && prev.kind === "item";
      if (!both || includeLists) {
        const [line, next, nextWritten] = b.sents[0];
        boundaries.push({
          kind: both ? "項目間" : b.kind === "item" ? "箇条へ" : "段落間",
          line,
          heading: b.head,
          before: prev.sents.at(-2)?.[1] ?? "",
          prev: prev.sents[prev.sents.length - 1][1],
          next,
          nextWritten,
          at: base,
        });
      }
    }
    for (let k = 1; k < b.sents.length; k++) {
      const [line, next, nextWritten] = b.sents[k];
      boundaries.push({
        kind: cell ? "セル内" : "段落内",
        line,
        heading: b.head,
        before:
          k >= 2
            ? b.sents[k - 2][1]
            : (joined && prev?.sents.at(-1)?.[1]) || "",
        prev: b.sents[k - 1][1],
        next,
        nextWritten,
        at: base + k,
      });
    }
    prev = b;
  }
  return { sentences, boundaries, headings };
}

/** sents は前 N 文、para は段落、sec は見出しの下(n=2 は文のある 1 つ前の見出しの下も)。after で対象の後ろも渡す */
export type Range =
  | { by: "all" }
  | { by: "sents"; n: number; after: boolean }
  | { by: "para"; after: boolean }
  | { by: "sec"; n: 1 | 2; after: boolean };

/** range の文を、対象を【対象】【/対象】で囲んで段落ごとに改行して並べる。既定は記事の頭から対象まで */
export function context(
  doc: Doc,
  b: Boundary,
  target = doc.sentences[b.at].text,
  range: Range = { by: "all" },
): string {
  const t = doc.sentences[b.at];
  const top =
    range.by === "sec" && range.n === 2
      ? (doc.sentences.findLast((s) => s.heading < t.heading)?.heading ??
        t.heading)
      : t.heading;
  const same = doc.sentences
    .map((s, i) => ({ ...s, i }))
    .filter(
      (s) => range.by === "all" || (s.heading >= top && s.heading <= t.heading),
    );
  const pos = same.findIndex((s) => s.i === b.at);
  let lo = 0;
  let hi = same.length;
  if (range.by === "sents")
    [lo, hi] = [Math.max(0, pos - range.n), pos + range.n + 1];
  if (range.by === "para") {
    const blk = (x: number) =>
      same.flatMap((s, k) => (s.block === x ? [k] : []));
    const mine = blk(t.block);
    const prevPara = mine[0] === pos ? same[pos - 1] : undefined;
    const nextPara = mine.at(-1) === pos ? same[pos + 1] : undefined;
    lo = prevPara ? blk(prevPara.block)[0] : mine[0];
    hi = ((nextPara ? blk(nextPara.block) : mine).at(-1) ?? pos) + 1;
  }
  if (range.by === "all" || !range.after) hi = pos + 1;
  const heads = range.by === "all" || (range.by === "sec" && range.n === 2);
  return lay(doc, same.slice(lo, hi), heads, (s) =>
    s.i === b.at ? `【対象】${target}【/対象】` : s.text,
  );
}

/** 記事の全文を、文ごとに頭に [sentences の位置] を付けて context と同じ形で並べる */
export function numbered(doc: Doc): string {
  return lay(
    doc,
    doc.sentences.map((s, i) => ({ ...s, i })),
    true,
    (s) => `[${s.i}]${s.text}`,
  );
}

function lay(
  doc: Doc,
  xs: (Sentence & { i: number })[],
  heads: boolean,
  show: (s: Sentence & { i: number }) => string,
): string {
  let text = "";
  for (const [k, s] of xs.entries()) {
    const start = k === 0 || s.block !== xs[k - 1].block;
    if (k > 0 && start) text += "\n";
    if (heads && s.heading > 0 && (k === 0 || s.heading !== xs[k - 1].heading))
      text += `## ${doc.headings[s.heading - 1]}\n`;
    if (s.item && start) text += "・";
    text += show(s);
  }
  return text;
}
