import { basename } from "node:path";
import { type Cut, describe, lowest, NO_CUT } from "./cut.ts";
import type { Row } from "./page.ts";
import { client, doc, lay, SHEET_CSS, summary, view } from "./sheet.ts";

/** CLI の --html。rows はすべての境目を記事の順で。足切りで落ちた文は数も印も付けない。first は数に使う最初の provider */
export function renderHtml(
  file: string,
  text: string,
  rows: Row[],
  cut: Cut,
  first: string,
): string {
  const T = client();
  const shown = new Set(lowest(rows, cut));
  const note =
    cut === NO_CUT ? "" : `。数を出したのは ${shown.size} 文(${describe(cut)})`;
  const o = { bert: first === "bert" };
  const lines = lay(text, rows);
  const D = view(
    rows,
    rows.map((r) => shown.has(r)),
    lines,
  );
  const meta = `${summary(rows, o.bert)}${note}・判定: ${T.esc(first)}`;
  const name = T.esc(basename(file));
  const json = JSON.stringify(D).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${name}</title>
<style>html,body{height:100%;margin:0;background:#fdfdfb}.tg{height:100%}${SHEET_CSS}</style></head><body>
<div class="tg">
<header class="tg-bar"><span class="tg-brand">tsunagari</span><span class="tg-name" title="${T.esc(file)}">${name}</span><span class="tg-sum">${meta}</span></header>
<div class="tg-main"><div class="tg-col"><p class="tg-meta">${meta}</p><article class="tg-doc">${doc(lines, D)}</article></div><aside class="tg-side" aria-label="選んだ文と一覧">${T.side(D, o, T.order(D, "low")[0] ?? null, "low")}</aside></div>
</div>
<script type="application/json" id="data">${json}</script>
<script>(${client})().mount(document.querySelector(".tg"),JSON.parse(document.getElementById("data").textContent),${JSON.stringify(o)});</script>
</body></html>
`;
}
