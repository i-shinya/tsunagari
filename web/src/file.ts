/** text は改行を LF にそろえた中身、why は読まない理由の文 */
export type Read = { readonly text: string } | { readonly why: string };

const TEXT_NAME = /\.(md|markdown|txt)$/i;
const MAX_BYTES = 1_000_000;
const NAME_CHARS = 16;

const short = (name: string) => {
  const cs = [...name];
  if (cs.length <= NAME_CHARS) return name;
  const ext = /\.[^.]{1,8}$/.exec(name)?.[0] ?? "";
  return `${cs.slice(0, NAME_CHARS - 1 - ext.length).join("")}…${ext}`;
};

// docs/design/web.md「入口」参照
export async function readPicked(f: File): Promise<Read> {
  const name = short(f.name);
  if (!TEXT_NAME.test(f.name) && !f.type.startsWith("text/"))
    return {
      why: `「${name}」は読めません。.md か .txt を選んでください`,
    };
  if (f.size === 0) return { why: `「${name}」は空です` };
  if (f.size > MAX_BYTES)
    return { why: `「${name}」は大きすぎて開けません(1 MB まで)` };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await f.arrayBuffer(),
    );
    return { text: text.replace(/\r\n?/g, "\n") };
  } catch {
    return {
      why: `「${name}」は読めません。UTF-8 で保存し直してください`,
    };
  }
}
