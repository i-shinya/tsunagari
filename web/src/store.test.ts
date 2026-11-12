import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  clear,
  download as downloadWith,
  FILES,
  missing,
  SIZES,
  savedBytes,
} from "./store.ts";

const ZEROS = new Uint8Array(64 * 2 ** 20);
const vocab = FILES.q8[1].url;
let names: Map<string, Map<string, number>>;
let fetched: string[];
let policies: (string | undefined)[];
let sizeOf: Map<string, number>;
let putFails: DOMException | undefined;

const download = (v: "q8", onBytes: (done: number) => void) =>
  downloadWith(v, onBytes, new AbortController().signal);
const body = (n: number, signal?: AbortSignal | null) =>
  new ReadableStream<Uint8Array>({
    pull(c) {
      if (signal?.aborted) return c.error(signal.reason);
      const k = Math.min(n, ZEROS.length);
      if (k > 0) c.enqueue(ZEROS.subarray(0, k));
      n -= k;
      if (n === 0) c.close();
    },
  });

beforeEach(() => {
  names = new Map();
  fetched = [];
  policies = [];
  sizeOf = new Map(FILES.q8.map((f) => [f.url, f.bytes]));
  putFails = undefined;
  const find = (url: string, name: string) => names.get(name)?.get(url);
  vi.stubGlobal("caches", {
    open: async (name: string) => {
      const m = names.get(name) ?? new Map<string, number>();
      names.set(name, m);
      return {
        put: async (url: string, res: Response) => {
          if (putFails) throw putFails;
          let n = 0;
          for await (const c of res.body ?? []) n += c.byteLength;
          m.set(url, n);
        },
        keys: async () => [...m.keys()],
        match: async (url: string) => {
          const n = m.get(url);
          return n === undefined
            ? undefined
            : { blob: async () => ({ size: n }) };
        },
      };
    },
    match: async (url: string, o: { cacheName: string }) =>
      find(url, o.cacheName) === undefined ? undefined : new Response(""),
    keys: async () => [...names.keys()],
    delete: async (name: string) => names.delete(name),
  });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    fetched.push(url);
    policies.push(init?.referrerPolicy);
    return new Response(body(sizeOf.get(url) ?? 0, init?.signal));
  });
});
afterEach(() => vi.unstubAllGlobals());

test("取った後は保存済みになる", async () => {
  expect(await missing("q8")).toBe(SIZES.q8);
  await download("q8", () => {});
  expect(await missing("q8")).toBe(0);
});

test("取る要求は Referer を送らない", async () => {
  await download("q8", () => {});
  expect(new Set(policies)).toEqual(new Set(["no-referrer"]));
});

test("保存から 1 つ欠けると、その分だけが足りない", async () => {
  await download("q8", () => {});
  for (const m of names.values()) m.delete(vocab);
  expect(await missing("q8")).toBe(FILES.q8[1].bytes);
});

test("取り直すと、欠けた 1 つだけを取る", async () => {
  await download("q8", () => {});
  for (const m of names.values()) m.delete(vocab);
  fetched = [];
  await download("q8", () => {});
  expect(fetched).toEqual([vocab]);
});

test("届いた大きさが違うファイルは保存せず、取るのが失敗する", async () => {
  sizeOf.set(vocab, 10);
  await expect(download("q8", () => {})).rejects.toThrow("10 バイト");
  expect([...names.values()].some((m) => m.has(vocab))).toBe(false);
  expect(await missing("q8")).toBe(SIZES.q8 - FILES.q8[0].bytes);
});

test("消した後は未保存になる", async () => {
  await download("q8", () => {});
  await clear();
  expect(await missing("q8")).toBe(SIZES.q8);
});

test("消すと前の revision の箱も消え、ほかの名前の箱は残る", async () => {
  names.set("tsunagari-bert-0000000", new Map());
  names.set("other", new Map());
  await clear();
  expect([...names.keys()]).toEqual(["other"]);
});

test("取る前に前の revision の箱を消し、ほかの名前の箱は残す", async () => {
  names.set("tsunagari-bert-0000000", new Map([["x", 1]]));
  names.set("other", new Map());
  let oldAtEstimate: boolean | undefined;
  vi.stubGlobal("navigator", {
    storage: {
      estimate: async () => {
        oldAtEstimate = names.has("tsunagari-bert-0000000");
        return { quota: SIZES.q8 * 2, usage: 0 };
      },
    },
  });
  await download("q8", () => {});
  expect(oldAtEstimate).toBe(false);
  expect(
    [...names.keys()].filter((n) => n.startsWith("tsunagari-bert-")),
  ).toHaveLength(1);
  expect(names.has("tsunagari-bert-0000000")).toBe(false);
  expect(names.has("other")).toBe(true);
});

test.each([
  [SIZES.q8, false],
  [SIZES.q8 - 1, true],
])(
  "空きが %i バイトで、失敗するか(%s)。足りなければ取らずに止まる",
  async (free, fails) => {
    vi.stubGlobal("navigator", {
      storage: { estimate: async () => ({ quota: free + 100, usage: 100 }) },
    });
    const run = download("q8", () => {});
    if (fails) {
      await expect(run).rejects.toMatchObject({ name: "QuotaExceededError" });
      expect(fetched).toEqual([]);
    } else {
      await run;
      expect(await missing("q8")).toBe(0);
    }
  },
);

test.each(["NetworkError", "QuotaExceededError"])(
  "保存が %s で落ちたら、同じ名前の失敗になる",
  async (name) => {
    putFails = new DOMException("x", name);
    await expect(download("q8", () => {})).rejects.toMatchObject({ name });
  },
);

test("中止すると取りかけのファイルは保存されず、次は欠けた分だけを取る", async () => {
  const model = FILES.q8[0].url;
  await download("q8", () => {});
  for (const m of names.values()) m.delete(model);
  const halt = new AbortController();
  const run = downloadWith(
    "q8",
    (done) => done > SIZES.q8 - FILES.q8[0].bytes && halt.abort(),
    halt.signal,
  );
  await expect(run).rejects.toMatchObject({ name: "AbortError" });
  expect([...names.values()].some((m) => m.has(model))).toBe(false);
  fetched = [];
  await download("q8", () => {});
  expect(fetched).toEqual([model]);
});

const box = (fs: readonly { url: string; bytes: number }[]) =>
  new Map(fs.map((f) => [f.url, f.bytes]));
test.each([
  ["1 つの版", [["tsunagari-bert-a", box(FILES.q8)]], SIZES.q8],
  [
    "2 つの版",
    [["tsunagari-bert-a", box([...FILES.q8, FILES.fp16[0]])]],
    SIZES.q8 + FILES.fp16[0].bytes,
  ],
  [
    "前の revision の箱",
    [
      ["tsunagari-bert-a", box(FILES.q8)],
      ["tsunagari-bert-0000000", new Map([["old", 7]])],
    ],
    SIZES.q8 + 7,
  ],
] as const)(
  "保存の大きさは、%s なら中身の合計(ほかの名前の箱は数えない)",
  async (_, boxes, bytes) => {
    for (const [name, m] of boxes) names.set(name, new Map(m));
    names.set("other", new Map([["x", 100]]));
    expect(await savedBytes()).toBe(bytes);
  },
);
