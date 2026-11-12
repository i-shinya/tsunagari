import { expect, test } from "vitest";
import { readPicked } from "./file.ts";

const utf8 = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.each([
  [
    "md は中身を返す",
    "a.md",
    "",
    utf8("# 題\n\n本文。"),
    { text: "# 題\n\n本文。" },
  ],
  [
    "txt は CRLF を LF にして返す",
    "a.txt",
    "text/plain",
    utf8("一。\r\n二。"),
    { text: "一。\n二。" },
  ],
  [
    "名前が違っても type が text/ なら読む",
    "a",
    "text/markdown",
    utf8("本文。"),
    { text: "本文。" },
  ],
  [
    "png は読まない",
    "a.png",
    "image/png",
    PNG,
    {
      why: "「a.png」は読めません。.md か .txt を選んでください",
    },
  ],
  [
    "UTF-8 で読めない md は読まない",
    "a.md",
    "",
    new Uint8Array([0x82, 0xa0]),
    {
      why: "「a.md」は読めません。UTF-8 で保存し直してください",
    },
  ],
  [
    "空のファイルは読まない",
    "a.md",
    "",
    new Uint8Array(),
    { why: "「a.md」は空です" },
  ],
  [
    "16 字までの名前はそのまま出す",
    "1234567890123.md",
    "",
    new Uint8Array(),
    { why: "「1234567890123.md」は空です" },
  ],
  [
    "16 字を超える名前は途中を省き拡張子を残す",
    "とても長いファイル名のメモ書き下書き_最終版.png",
    "image/png",
    PNG,
    {
      why: "「とても長いファイル名の….png」は読めません。.md か .txt を選んでください",
    },
  ],
  [
    "1 MB を超えるファイルは読まない",
    "a.md",
    "",
    new Uint8Array(1_000_001).fill(0x61),
    { why: "「a.md」は大きすぎて開けません(1 MB まで)" },
  ],
])("%s", async (_, name, type, bytes, want) => {
  expect(await readPicked(new File([bytes], name, { type }))).toEqual(want);
});
