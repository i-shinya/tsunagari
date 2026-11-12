import { expect, test } from "vitest";
import { createTokenizer } from "./tokenize.ts";

const dogs = "犬 ".repeat(300);
const cats = "猫 ".repeat(300);
const few = "猫 ".repeat(10);
const n = (piece: string, count: number): string[] => Array(count).fill(piece);

// lindera は lindera-unidic-5.3.0 の tokenizeSurfaces、hf は HF の BertJapaneseTokenizer の出力を 1 度だけ取って写したもの
test.each([
  {
    name: "数字と英字の続きを 1 語に繋ぐ",
    a: "API の 18 番",
    b: "SSH で 300 回",
    lindera: {
      "API の 18 番": ["A", "P", "I", "の", "1", "8", "番"],
      "SSH で 300 回": ["S", "S", "H", "で", "3", "0", "0", "回"],
    },
    hf: [
      "[CLS]",
      "API",
      "の",
      "18",
      "番",
      "[SEP]",
      "SS",
      "##H",
      "で",
      "300",
      "回",
      "[SEP]",
    ],
  },
  {
    name: "NFKC で変えてから区切る",
    a: "ＡＰＩ１８ ｶﾅ",
    b: "ﾃｽﾄ",
    lindera: {
      "API18 カナ": ["A", "P", "I", "1", "8", "カナ"],
      テスト: ["テスト"],
    },
    hf: ["[CLS]", "API", "18", "カナ", "[SEP]", "テスト", "[SEP]"],
  },
  {
    name: "空白で離れた数字と英字は繋がない",
    a: "1 2 番",
    b: "x y",
    lindera: { "1 2 番": ["1", "2", "番"], "x y": ["x", "y"] },
    hf: ["[CLS]", "1", "2", "番", "[SEP]", "x", "y", "[SEP]"],
  },
  {
    name: "文中の特殊トークンは区切らずその id にする",
    a: "入力に[UNK]が混ざる。",
    b: "[MASK]を予測する。",
    lindera: {
      入力に: ["入力", "に"],
      "が混ざる。": ["が", "混ざる", "。"],
      "を予測する。": ["を", "予測", "する", "。"],
    },
    hf: [
      "[CLS]",
      "入力",
      "に",
      "[UNK]",
      "が",
      "混",
      "##ざ",
      "##る",
      "。",
      "[SEP]",
      "[MASK]",
      "を",
      "予測",
      "する",
      "。",
      "[SEP]",
    ],
  },
  {
    name: "対の無いサロゲートは U+FFFD にしてから区切る",
    a: "前\ud800後",
    b: "次の文。",
    lindera: {
      "前�後": ["前", "�", "後"],
      "次の文。": ["次", "の", "文", "。"],
    },
    hf: [
      "[CLS]",
      "前",
      "[UNK]",
      "後",
      "[SEP]",
      "次",
      "の",
      "文",
      "。",
      "[SEP]",
    ],
  },
  {
    name: "256 を超える組は長い方だけを削る",
    a: dogs,
    b: few,
    lindera: { [dogs]: n("犬", 300), [few]: n("猫", 10) },
    hf: ["[CLS]", ...n("犬", 243), "[SEP]", ...n("猫", 10), "[SEP]"],
  },
  {
    name: "同じ長さまで削ったら b から削る",
    a: dogs,
    b: cats,
    lindera: { [dogs]: n("犬", 300), [cats]: n("猫", 300) },
    hf: ["[CLS]", ...n("犬", 127), "[SEP]", ...n("猫", 126), "[SEP]"],
  },
])("$name", ({ a, b, lindera, hf }) => {
  const vocab = [...new Set(["[PAD]", "[UNK]", "[CLS]", "[SEP]", ...hf])];
  const segment = (text: string): string[] => {
    const words = (lindera as Record<string, string[]>)[text];
    if (!words) throw new Error(`記録に無い入力: ${text}`);
    return words;
  };
  const { inputIds } = createTokenizer(vocab.join("\n"), segment)(a, b);
  expect(inputIds.map((id) => vocab[id])).toEqual(hf);
});
