import { DICT_DIR, HF, REVISION } from "../../src/bert-files.ts";
import { DICT_FILES, type DictFiles } from "../../src/tokenize.ts";

export { REVISION };

export type Variant = "fp16" | "q8";
export type Assets = {
  readonly model: Uint8Array;
  readonly vocab: string;
  readonly dict: DictFiles;
};
type File = { readonly url: string; readonly bytes: number };

const PREFIX = "tsunagari-bert-";
const CACHE = `${PREFIX}${REVISION.slice(0, 7)}`;
const DICT_BYTES: Record<keyof DictFiles, number> = {
  "metadata.json": 28690,
  "dict.trie": 3172216,
  "dict.valsidx": 789592,
  "dict.vals": 3115400,
  "matrix.mtx": 27721465,
  "char_def.bin": 767,
  "unk.bin": 636,
};
const VOCAB = `${HF}vocab.txt`;
const dictUrl = (name: keyof DictFiles) => `${HF}${DICT_DIR}/${name}.gz`;
const SHARED: File[] = [
  { url: VOCAB, bytes: 231026 },
  ...DICT_FILES.map((n) => ({ url: dictUrl(n), bytes: DICT_BYTES[n] })),
];

/** 版ごとに取るファイルと期待するバイト数。頭が重み。辞書と vocab は版で共有する */
export const FILES: Record<Variant, readonly File[]> = {
  fp16: [{ url: `${HF}fp16/model.onnx`, bytes: 675426456 }, ...SHARED],
  q8: [{ url: `${HF}q8/model.onnx`, bytes: 481964362 }, ...SHARED],
};
const sum = (fs: readonly File[]) => fs.reduce((s, f) => s + f.bytes, 0);
export const SIZES: Record<Variant, number> = {
  fp16: sum(FILES.fp16),
  q8: sum(FILES.q8),
};

const has = async (f: File) =>
  (await caches.match(f.url, { cacheName: CACHE })) !== undefined;

/** 版のファイルのうち、まだ保存していない分のバイト数。0 なら保存済み */
export async function missing(v: Variant): Promise<number> {
  const there = await Promise.all(FILES[v].map(has));
  return sum(FILES[v].filter((_, i) => !there[i]));
}

/** 無いファイルだけを取って保存する。大きさの違う中身は保存しない。onBytes は保存済みを含めた累計。
 * 空きが足りないときは QuotaExceededError の DOMException を投げる */
export async function download(
  v: Variant,
  onBytes: (done: number) => void,
  signal: AbortSignal,
): Promise<void> {
  // docs/design/web.md「重みの取り方と保存」参照
  const old = (await caches.keys()).filter(
    (n) => n.startsWith(PREFIX) && n !== CACHE,
  );
  await Promise.all(old.map((n) => caches.delete(n)));
  const cache = await caches.open(CACHE);
  const there = await Promise.all(FILES[v].map(has));
  let done = sum(FILES[v].filter((_, i) => there[i]));
  const est = await navigator.storage?.estimate();
  const need = SIZES[v] - done;
  const free = (est?.quota ?? Infinity) - (est?.usage ?? 0);
  if (need > free) {
    const mib = (n: number) => Math.ceil(n / 2 ** 20);
    throw new DOMException(
      `保存できる量が足りません(あと ${mib(need)} MiB、空き ${mib(free)} MiB)`,
      "QuotaExceededError",
    );
  }
  onBytes(done);
  for (const [i, f] of FILES[v].entries()) {
    if (there[i]) continue;
    signal.throwIfAborted();
    // Cache Storage に置くので、HTTP のキャッシュにまで同じ数百 MB を残さない
    // Referer は docs/design/web.md「重みの取り方と保存」参照
    const res = await fetch(f.url, {
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`${f.url} が ${res.status}`);
    let got = 0;
    const count = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        got += chunk.byteLength;
        onBytes(done + got);
        c.enqueue(chunk);
      },
      flush() {
        if (got !== f.bytes)
          throw new Error(`${f.url} が ${got} バイト(期待 ${f.bytes})`);
      },
    });
    await cache.put(f.url, new Response(res.body.pipeThrough(count)));
    done += f.bytes;
  }
}

export async function load(v: Variant): Promise<Assets> {
  const get = async (url: string) => {
    const res = await caches.match(url, { cacheName: CACHE });
    if (!res?.body) throw new Error(`保存に ${url} が無い`);
    return res;
  };
  const gunzip = async (name: keyof DictFiles) =>
    new Uint8Array(
      await new Response(
        (await get(dictUrl(name))).body?.pipeThrough(
          new DecompressionStream("gzip"),
        ),
      ).arrayBuffer(),
    );
  const dict = Object.fromEntries(
    await Promise.all(DICT_FILES.map(async (n) => [n, await gunzip(n)])),
  ) as DictFiles;
  return {
    model: new Uint8Array(await (await get(FILES[v][0].url)).arrayBuffer()),
    vocab: await (await get(VOCAB)).text(),
    dict,
  };
}

/** 版と revision を問わず、保存した中身のバイト数。clear で空く量 */
export async function savedBytes(): Promise<number> {
  let n = 0;
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX)) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys())
      n += (await (await cache.match(req))?.blob())?.size ?? 0;
  }
  return n;
}

/** 版と revision を問わず、保存したものを全部消す */
export async function clear(): Promise<void> {
  const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX));
  await Promise.all(names.map((n) => caches.delete(n)));
}
