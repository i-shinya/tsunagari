import type * as Lindera from "lindera-wasm";

/** lindera-unidic-5.3.0 の辞書のファイル。loadDictionaryFromBytes に渡す順。 */
export const DICT_FILES = [
  "metadata.json",
  "dict.trie",
  "dict.valsidx",
  "dict.vals",
  "matrix.mtx",
  "char_def.bin",
  "unk.bin",
] as const;
export type DictFiles = Record<(typeof DICT_FILES)[number], Uint8Array>;

/** lindera の語の表層。入力の部分文字列を順に返す。空白の語も入ってよい。 */
export type Segment = (text: string) => string[];

/** 詰めていない 1 組。attentionMask は全部 1。token_type_ids は持たず、呼ぶ側が 0 を渡す。 */
export type Encoded = {
  readonly inputIds: readonly number[];
  readonly attentionMask: readonly number[];
};
export type Tokenize = (a: string, b: string) => Encoded;

const MAX_LENGTH = 256;
const RUNS = [/^[0-9]+$/, /^[A-Za-z]+$/];
const SPECIALS = /(\[(?:PAD|UNK|CLS|SEP|MASK)\])/;

/** HF の BertJapaneseTokenizer(a, b, truncation=True, max_length=256) に合わせた ids を作る。 */
export function createTokenizer(vocabText: string, segment: Segment): Tokenize {
  // docs/design/web.md「区切り」参照
  const lines = vocabText.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const vocab = new Map(lines.map((piece, id) => [piece, id]));
  const special = (piece: string): number => {
    const id = vocab.get(piece);
    if (id === undefined) throw new Error(`vocab に ${piece} が無い`);
    return id;
  };
  const [UNK, CLS, SEP] = [
    special("[UNK]"),
    special("[CLS]"),
    special("[SEP]"),
  ];

  const words = (text: string): string[] => {
    const n = text.normalize("NFKC");
    const out: string[] = [];
    let cursor = 0;
    for (const s of segment(n).filter((x) => x.trim() !== "")) {
      const start = n.indexOf(s, cursor);
      if (start < 0) throw new Error(`区切りが入力の部分文字列でない: ${s}`);
      const last = out.at(-1);
      if (
        last !== undefined &&
        start === cursor &&
        RUNS.some((r) => r.test(last) && r.test(s))
      )
        out[out.length - 1] = last + s;
      else out.push(s);
      cursor = start + s.length;
    }
    return out;
  };

  const wordpiece = (word: string): number[] => {
    const chars = Array.from(word);
    if (chars.length > 100) return [UNK];
    const out: number[] = [];
    for (let start = 0; start < chars.length; ) {
      let end = chars.length;
      let id: number | undefined;
      for (; start < end; end--) {
        id = vocab.get(
          (start > 0 ? "##" : "") + chars.slice(start, end).join(""),
        );
        if (id !== undefined) break;
      }
      if (id === undefined) return [UNK];
      out.push(id);
      start = end;
    }
    return out;
  };

  const ids = (text: string): number[] =>
    text
      .toWellFormed()
      .split(SPECIALS)
      .flatMap((chunk, i) =>
        i % 2
          ? [special(chunk)]
          : chunk
            ? words(chunk).flatMap((w) =>
                w.split(/\s+/).filter(Boolean).flatMap(wordpiece),
              )
            : [],
      );

  return (a, b) => {
    const x = ids(a);
    const y = ids(b);
    while (x.length + y.length + 3 > MAX_LENGTH)
      (x.length > y.length ? x : y).pop();
    const inputIds = [CLS, ...x, SEP, ...y, SEP];
    return { inputIds, attentionMask: inputIds.map(() => 1) };
  };
}

/** 初期化済みの lindera(unidic、normal)を Segment にする。dict.words と dict.wordsidx は空で渡す。 */
export function linderaSegment(
  lindera: typeof Lindera,
  dict: DictFiles,
): Segment {
  const empty = new Uint8Array(0);
  const d = lindera.loadDictionaryFromBytes(
    dict["metadata.json"],
    dict["dict.trie"],
    dict["dict.valsidx"],
    dict["dict.vals"],
    empty,
    empty,
    dict["matrix.mtx"],
    dict["char_def.bin"],
    dict["unk.bin"],
  );
  const builder = new lindera.TokenizerBuilder();
  builder.setDictionaryInstance(d);
  builder.setMode("normal");
  const tokenizer = builder.build();
  return (text) => tokenizer.tokenizeSurfaces(text);
}
