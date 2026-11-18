import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { DICT_DIR, ORT_VERSION, REVISION } from "./bert-files.ts";
import { DICT_FILES } from "./tokenize.ts";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
const worker = fileURLToPath(new URL("./bert-worker.ts", import.meta.url));
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const home = mkdtempSync(join(tmpdir(), "tsunagari-home-"));
const none = join(home, "none.md");
const single = join(home, "single.md");
const two = join(home, "two.md");
writeFileSync(single, "一つだけの文です。\n");
writeFileSync(two, "一つ目の文です。二つ目の文です。\n");
const conn = join(home, "conn.md");
writeFileSync(conn, "あの文です。しかし、いの文です。うの文です。\n");
const {
  TYPESAFE_API_KEY: _1,
  TSUNAGARI_MAX_SCORE: _2,
  TSUNAGARI_MAX_COUNT: _3,
  ...rest
} = process.env;
const assets = join(home, ".cache", "tsunagari", "bert-onnx", REVISION);
for (const f of [
  "fp16/model.onnx",
  "q8/model.onnx",
  ...DICT_FILES.map((n) => `${DICT_DIR}/${n}`),
]) {
  mkdirSync(dirname(join(assets, f)), { recursive: true });
  writeFileSync(join(assets, f), "");
}
writeFileSync(
  join(assets, "vocab.txt"),
  "[PAD]\n[UNK]\n[CLS]\n[SEP]\n[MASK]\n",
);
const env = {
  ...rest,
  HOME: home,
  USERPROFILE: home,
  NODE_OPTIONS: `--import=${pathToFileURL(fileURLToPath(new URL("../test-fixtures/bert-hook.mjs", import.meta.url))).href}`,
};
const noBash = { PATH: mkdtempSync(join(tmpdir(), "tsunagari-path-")) };
const badHome = mkdtempSync(join(tmpdir(), "tsunagari-home-"));
mkdirSync(join(badHome, ".config", "tsunagari"), { recursive: true });
writeFileSync(
  join(badHome, ".config", "tsunagari", "settings.env"),
  "TSUNAGARI_MAX_SCORE=2\n",
);

test.each([
  { args: ["--version"], status: 0, stdout: `${version}\n` },
  { args: ["--bogus"], status: 2, stdout: "" },
  { args: ["--connectives-fit", two], status: 2, stdout: "" },
  { args: [two, "--html"], status: 2, stdout: "" },
  { args: [none], status: 2, stdout: "" },
  { args: [single], status: 3, stdout: "" },
  { args: [two, "--provider", "jev"], status: 3, stdout: "" },
  {
    args: [two],
    extra: { FAKE_BERT: "fail" },
    status: 3,
    stdout: "",
    stderr: "bert: CUDA が無い\n",
  },
  {
    args: [two, "--bert-weights", "bogus"],
    status: 2,
    stdout: "",
    stderr: "--bert-weights は fp16 か q8: bogus",
  },
  {
    args: [two, "--bert-weights", "q8", "--provider", "jev"],
    status: 2,
    stdout: "",
    stderr: "--bert-weights は bert を選んだときだけ使う",
  },
  {
    args: [two, "--provider", "bert", "--connectives"],
    status: 2,
    stdout: "",
    stderr: "bert は --connectives を聞けない",
  },
  {
    args: [two, "--context", "all"],
    status: 2,
    stdout: "",
    stderr: "bert は前の 2 文で聞くので --context を使わない",
  },
  {
    args: [two, "--connectives"],
    status: 3,
    stdout: "",
    stderr: "TYPESAFE_API_KEY",
  },
  {
    args: ["--dry-run", two],
    extra: noBash,
    status: 0,
    stdout: `${JSON.stringify({
      version,
      providers: ["bert"],
      estimate: {
        boundaries: 1,
        send: 1,
        tokens: 0,
        usd: 0,
        maxUsd: 0.5,
        overBudget: false,
      },
    })}\n`,
  },
  {
    args: ["--dry-run", "--provider", "jev", "--max-usd", "0.0000001", two],
    status: 0,
    stdout: /"overBudget":true/,
  },
  {
    args: [two, "--provider", "bogus"],
    status: 2,
    stdout: "",
    stderr: "bogus",
  },
  ...["clef-flash", "clef", "nova-6-luna"].map((p) => ({
    args: [two, "--provider", `jev,${p}`],
    status: 2,
    stdout: "",
    stderr: `知らない provider: ${p}(使えるのは bert, jev)`,
  })),
  {
    args: ["--dry-run", "--provider", "jev", two],
    status: 0,
    stdout:
      /"providers":\["jev"\],"estimate":\{"boundaries":1,"send":1,"tokens":\d+,"usd":0\.0000\d+/,
  },
  {
    args: ["--dry-run", "--connectives", conn],
    status: 0,
    stdout: /"boundaries":2,"send":3,"tokens":\d+/,
    stderr: "呼び出し 2 回にまとめる",
  },
  {
    args: ["--dry-run", "--connectives-choice", conn],
    status: 0,
    stdout: /"boundaries":2,"send":3,"tokens":\d+/,
    stderr: "呼び出し 2 回にまとめる",
  },
  {
    args: ["--connectives", "--connectives-choice", conn],
    status: 2,
    stdout: "",
    stderr: "--connectives と --connectives-choice",
  },
  {
    args: ["--connectives-choice", "--context", "ctx2", two],
    status: 2,
    stdout: "",
    stderr: "--connectives-choice では使えない範囲: ctx2",
  },
  {
    args: ["--dry-run", "--provider", "jev", conn],
    status: 0,
    stdout: /"boundaries":2,"send":2,"tokens":\d+/,
    stderr: "呼び出し 1 回にまとめる",
  },
  {
    args: ["--max-usd", "0.0000001", "--provider", "jev", two],
    status: 3,
    stdout: "",
  },
  { args: ["--max-usd", "abc", two], status: 2, stdout: "" },
  {
    args: ["--context", "s0", "--provider", "jev", two],
    status: 2,
    stdout: "",
    stderr: "知らない範囲: s0",
  },
  {
    args: ["--connectives", "--context", "ctx2", two],
    status: 2,
    stdout: "",
    stderr: "ctx2",
  },
  {
    args: [two],
    extra: { TSUNAGARI_MAX_SCORE: "abc" },
    status: 2,
    stdout: "",
    stderr: "TSUNAGARI_MAX_SCORE",
  },
  {
    args: ["--dry-run", two],
    extra: { TSUNAGARI_MAX_SCORE: "abc" },
    status: 2,
    stdout: "",
  },
  {
    args: [two],
    extra: { TSUNAGARI_MAX_COUNT: "0" },
    status: 2,
    stdout: "",
    stderr: "TSUNAGARI_MAX_COUNT",
  },
  {
    args: [two],
    extra: { HOME: badHome, USERPROFILE: badHome },
    status: 2,
    stdout: "",
    stderr: "settings.env",
  },
])(
  "tsunagari $args $extra exits $status",
  ({ args, extra, status, stdout, stderr }) => {
    const r = spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { ...env, ...extra },
    });
    expect(r.status).toBe(status);
    if (typeof stdout === "string") expect(r.stdout).toBe(stdout);
    else expect(r.stdout).toMatch(stdout);
    if (stderr) expect(r.stderr).toContain(stderr);
  },
);

const four = join(home, "four.md");
writeFileSync(four, "あの文です。いの文です。うの文です。えの文です。\n");

test("dist に刻んだ version.txt があると、--version と JSON の version はその版を出す", () => {
  const stamp = new URL("./version.txt", import.meta.url);
  writeFileSync(stamp, "9.9.9+abc1234\n");
  try {
    const run = (args: string[]) =>
      spawnSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        env: { ...env, FAKE_BERT: "[0.5]" },
      }).stdout;
    expect(run(["--version"])).toBe("9.9.9+abc1234\n");
    expect(JSON.parse(run(["--dry-run", two])).version).toBe("9.9.9+abc1234");
    expect(JSON.parse(run([two])).version).toBe("9.9.9+abc1234");
  } finally {
    rmSync(stamp);
  }
});

test("境目が 3 か所未満で順位の相関を測れないと、rho は null になる", () => {
  const stub = join(home, "same-stub.mjs");
  writeFileSync(
    stub,
    "globalThis.fetch = async () => Response.json({ answers: { follows: { noul: 0.5 } } });",
  );
  const r = spawnSync(
    process.execPath,
    ["--import", stub, cli, two, "--provider", "jev,bert", "--context", "all"],
    {
      encoding: "utf8",
      env: { ...env, TYPESAFE_API_KEY: "a", FAKE_BERT: "[0.5]" },
    },
  );
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).correlations).toEqual([
    { a: "jev", b: "bert", rho: null },
  ]);
});

test("--context s1 の --dry-run は、記事の頭からより少ないトークンを出す", () => {
  const tokens = (args: string[]) => {
    const r = spawnSync(
      process.execPath,
      [cli, "--dry-run", "--provider", "jev", four, ...args],
      {
        encoding: "utf8",
        env,
      },
    );
    return JSON.parse(r.stdout).estimate.tokens as number;
  };
  expect(tokens(["--context", "s1"])).toBeLessThan(
    tokens(["--context", "all"]),
  );
});
test("既定では BERT に前の 2 文と後ろの文を渡し、低い順に境目を出す", () => {
  rmSync(join(home, "bert-in.txt"), { force: true });
  const r = spawnSync(process.execPath, [cli, four], {
    encoding: "utf8",
    env: { ...env, FAKE_BERT: "[0.5,0.1,0.9]" },
  });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual({
    version,
    providers: ["bert"],
    boundaries: [
      {
        line: 1,
        scores: { bert: 0.1 },
        prev: "いの文です。",
        next: "うの文です。",
      },
      {
        line: 1,
        scores: { bert: 0.5 },
        prev: "あの文です。",
        next: "いの文です。",
      },
      {
        line: 1,
        scores: { bert: 0.9 },
        prev: "うの文です。",
        next: "えの文です。",
      },
    ],
    correlations: [],
  });
  expect(r.stdout.trimEnd()).not.toContain("\n");
  expect(r.stderr).toContain("境目 3 か所を測る(bert)");
  expect(
    readFileSync(join(home, "bert-in.txt"), "utf8").trimEnd().split("\n"),
  ).toEqual([
    "あの文です。",
    "いの文です。",
    "あの文です。 いの文です。",
    "うの文です。",
    "いの文です。 うの文です。",
    "えの文です。",
  ]);
});
test.each([
  {
    name: "GPU の推論の失敗",
    backend: "dml",
    extra: { FAKE_BERT: "fail" },
    status: 1,
  },
  {
    name: "GPU の値が数でない",
    backend: "dml",
    extra: { FAKE_BERT: "[1]" },
    status: 1,
  },
  {
    name: "CPU の推論の失敗",
    backend: "cpu",
    extra: { FAKE_BERT: "fail" },
    status: 3,
  },
])("worker の終わり方: $name は $status", ({ backend, extra, status }) => {
  const src = join(home, "pairs.json");
  writeFileSync(src, JSON.stringify([["前の文です。", "後ろの文です。"]]));
  const r = spawnSync(
    process.execPath,
    [worker, "fp16", backend, src, join(home, "out.json")],
    { encoding: "utf8", env: { ...env, ...extra } },
  );
  expect(r.status).toBe(status);
  expect(r.stderr).toContain("bert-error: ");
});
test("worker は区切りの用意ができないと 3 で終わる(振り替えない)", () => {
  const r = spawnSync(
    process.execPath,
    [worker, "fp16", "dml", join(home, "no-such-pairs.json"), "y"],
    { encoding: "utf8", env },
  );
  expect(r.status).toBe(3);
  expect(r.stderr).toContain("bert-error: 区切りの用意ができない");
});
test("worker は重みを取れないと 3 で終わる(振り替えない)", () => {
  const empty = mkdtempSync(join(tmpdir(), "tsunagari-home-"));
  const stub = join(empty, "no-net.mjs");
  writeFileSync(
    stub,
    'globalThis.fetch = async () => { throw new Error("net"); };',
  );
  const r = spawnSync(
    process.execPath,
    ["--import", stub, worker, "fp16", "dml", "x", "y"],
    {
      encoding: "utf8",
      env: { ...env, HOME: empty, USERPROFILE: empty },
    },
  );
  expect(r.status).toBe(3);
  expect(r.stderr).toContain("bert-error: 重みを取れない: net");
});
test("worker は CUDA の写しを読めないと 1 で終わる(CPU へ振り替える)", () => {
  const src = join(home, "pairs.json");
  writeFileSync(src, JSON.stringify([["前の文です。", "後ろの文です。"]]));
  const r = spawnSync(
    process.execPath,
    [
      worker,
      "fp16",
      "cuda",
      src,
      join(home, "out.json"),
      join(home, "no-cuda"),
    ],
    { encoding: "utf8", env },
  );
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("bert-error: onnxruntime を読めない");
});
test.each([
  { args: ["init", two], status: 2, stderr: "Usage" },
  { args: ["--accept-nvidia-eula"], status: 2, stderr: "Usage" },
  { args: ["init", "--help"], status: 2, stderr: "Usage" },
  {
    args: ["init", "--accept-nvidia-eula", "--bert-weights", "q8"],
    status: 2,
    stderr: "Usage",
  },
  { args: ["init"], status: 2, stderr: "端末で実行してください" },
])("$args は $status で終わる", ({ args, status, stderr }) => {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(r.status).toBe(status);
  expect(r.stderr).toContain(stderr);
});
const fakeGpu = mkdtempSync(join(tmpdir(), "tsunagari-gpu-"));
writeFileSync(join(fakeGpu, "nvidia-smi"), "#!/bin/sh\nexit 0\n", {
  mode: 0o755,
});
const readyHome = mkdtempSync(join(tmpdir(), "tsunagari-home-"));
cpSync(join(home, ".cache"), join(readyHome, ".cache"), { recursive: true });
const readyOrt = join(
  readyHome,
  ".cache",
  "tsunagari",
  "cuda",
  `${ORT_VERSION}-linux-x64`,
  "node_modules",
  "onnxruntime-node",
);
mkdirSync(readyOrt, { recursive: true });
writeFileSync(join(readyOrt, "package.json"), "{}");
const linuxX64 = process.platform === "linux" && process.arch === "x64";
test.runIf(linuxX64).each([
  {
    name: "GPU が無い",
    PATH: noBash.PATH,
    HOME: home,
    status: 3,
    stderr: "見つからない",
  },
  { name: "用意済み", PATH: fakeGpu, HOME: readyHome, status: 0, stderr: "" },
])("init --accept-nvidia-eula は $name とき $status で終わる", (c) => {
  const r = spawnSync(process.execPath, [cli, "init", "--accept-nvidia-eula"], {
    encoding: "utf8",
    env: { ...env, PATH: c.PATH, HOME: c.HOME },
  });
  expect(r.status).toBe(c.status);
  expect(r.stderr).toContain(c.stderr);
});
test.runIf(linuxX64).each([
  {
    name: "用意が無い",
    HOME: home,
    want: "GPU を使うには tsunagari init を実行してください",
  },
  { name: "用意がある", HOME: readyHome, want: "GPU(cuda)で動かせない" },
])(
  "NVIDIA のある Linux で CUDA の$name と案内か起動の跡を出して CPU で動く",
  (c) => {
    const r = spawnSync(process.execPath, [cli, two], {
      encoding: "utf8",
      env: { ...env, FAKE_BERT: "[0.5]", PATH: fakeGpu, HOME: c.HOME },
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(c.want);
    expect(r.stderr).toContain("bert: cpu で動いた");
  },
);
test("--bert-weights q8 は q8 の重みを開く", () => {
  const r = spawnSync(process.execPath, [cli, two, "--bert-weights", "q8"], {
    encoding: "utf8",
    env: { ...env, FAKE_BERT: "[0.5]" },
  });
  expect(r.status).toBe(0);
  expect(readFileSync(join(home, "bert-model.txt"), "utf8")).toBe("q8");
});
const stub = join(home, "stub.mjs");
writeFileSync(
  stub,
  `const P = { い: 0.5, う: 0.1, え: 0.9 };
globalThis.fetch = async (url, init) => {
  const p = P[JSON.parse(init.body).state.対象の文[0]];
  return Response.json({ answers: { follows: { noul: p } } });
};`,
);
const runFour = (extra: NodeJS.ProcessEnv, args: string[] = []) =>
  spawnSync(
    process.execPath,
    [
      "--import",
      stub,
      cli,
      four,
      "--provider",
      " jev, bert,jev,",
      "--context",
      "all",
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        ...env,
        TYPESAFE_API_KEY: "a",
        FAKE_BERT: "[0.2,0.3,0.1]",
        ...extra,
      },
    },
  );
const rows = [
  {
    line: 1,
    scores: { jev: 0.1, bert: 0.3 },
    prev: "いの文です。",
    next: "うの文です。",
  },
  {
    line: 1,
    scores: { jev: 0.5, bert: 0.2 },
    prev: "あの文です。",
    next: "いの文です。",
  },
  {
    line: 1,
    scores: { jev: 0.9, bert: 0.1 },
    prev: "うの文です。",
    next: "えの文です。",
  },
];
const result = (boundaries: typeof rows) => ({
  version,
  providers: ["jev", "bert"],
  boundaries,
  correlations: [{ a: "jev", b: "bert", rho: -1 }],
});

test("--provider を 2 つ渡すと、最初の provider の低い順に両方のスコアを並べ、順位の相関を出す", () => {
  const r = runFour({});
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual(result(rows));
  expect(r.stderr).not.toContain("足切り");
});

test.each([
  { extra: { TSUNAGARI_MAX_COUNT: "2" }, shown: [rows[0], rows[1]] },
  { extra: { TSUNAGARI_MAX_SCORE: "0.05" }, shown: [] },
])(
  "足切り $extra では、通る境目だけを出し、相関はすべての境目で出す",
  ({ extra, shown }) => {
    const r = runFour(extra);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(result(shown));
    expect(r.stderr).toContain("足切り: ");
  },
);

test("足切りがあると、HTML の数値の印は標準出力に出した境目のスコアと同じになる", () => {
  const out = join(home, "cut.html");
  const r = runFour({ TSUNAGARI_MAX_SCORE: "0.5" }, ["--html", out]);
  expect(r.status).toBe(0);
  const chips = [
    ...readFileSync(out, "utf8").matchAll(/<span class="v">([\d.]+)</g),
  ].map((m) => m[1]);
  expect(JSON.parse(r.stdout)).toEqual(result([rows[0], rows[1]]));
  expect(chips.toSorted()).toEqual(["0.10", "0.50"]);
});

test("取り置きで全部当たる記事は、--dry-run で送る 0 件・$0 と出し、上限に掛からない", () => {
  const own = mkdtempSync(join(tmpdir(), "tsunagari-home-"));
  const md = join(own, "two.md");
  writeFileSync(md, "一つ目の文です。二つ目の文です。\n");
  const stub = join(own, "stub.mjs");
  writeFileSync(
    stub,
    "globalThis.fetch = async () => Response.json({ answers: { follows: { noul: 0.5 } } });",
  );
  const run = (args: string[]) =>
    spawnSync(process.execPath, [...args, md], {
      encoding: "utf8",
      env: { ...rest, HOME: own, USERPROFILE: own, TYPESAFE_API_KEY: "a" },
    });
  expect(
    run(["--import", stub, cli, "--provider", "jev", "--context", "all"])
      .status,
  ).toBe(0);
  const r = run([
    cli,
    "--dry-run",
    "--provider",
    "jev",
    "--context",
    "all",
    "--max-usd",
    "0.0000001",
  ]);
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).estimate).toMatchObject({
    send: 0,
    tokens: 0,
    usd: 0,
    overBudget: false,
  });
});

const connRows = [
  {
    line: 1,
    scores: { jev: 0.05 },
    prev: "あの文です。",
    next: "しかし、いの文です。",
  },
  {
    line: 1,
    scores: { jev: 0.5 },
    prev: "しかし、いの文です。",
    next: "うの文です。",
  },
];

test("--connectives-choice では、接続詞のある境目は 2 つの問いの低い方で並べ、送った本文の数を出す", () => {
  const stub = join(home, "conn-stub.mjs");
  writeFileSync(
    stub,
    `globalThis.fetch = async (url, init) => {
  const { state, questions } = JSON.parse(init.body);
  const q = questions.q.type === "choice"
    ? { probabilities: { 逆接: 0.05, 因果: 0.95 } }
    : { noul: state.文脈.includes("【対象】う") ? 0.5 : 0.9 };
  return Response.json({ answers: { q } });
};`,
  );
  const r = spawnSync(
    process.execPath,
    ["--import", stub, cli, conn, "--connectives-choice", "--context", "all"],
    { encoding: "utf8", env: { ...env, TYPESAFE_API_KEY: "a" } },
  );
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).boundaries).toEqual(connRows);
  expect(r.stderr).toContain("送った 3 か所、取り置きを使った 0 か所");
  expect(r.stderr).toContain("呼び出し 3 回、請求された入力 0 トークン");
});

test("--connectives は接続詞のある境目の 2 つ目の問いを選ばせずに聞き、2 つの低い方を出す", () => {
  const own = mkdtempSync(join(tmpdir(), "tsunagari-home-"));
  const stub = join(own, "conn-fit-stub.mjs");
  writeFileSync(
    stub,
    `globalThis.fetch = async (url, init) => {
  const { state, questions } = JSON.parse(init.body);
  const q = questions.q;
  if (q.type !== "noul") throw new Error("choice が来た");
  const p = q.instructions.includes("この言葉は") ? 0.05
    : state.文脈.includes("【対象】う") ? 0.5 : 0.9;
  return Response.json({ answers: { q: { noul: p } } });
};`,
  );
  const r = spawnSync(
    process.execPath,
    ["--import", stub, cli, conn, "--connectives", "--context", "all"],
    {
      encoding: "utf8",
      env: {
        ...rest,
        HOME: own,
        USERPROFILE: own,
        TYPESAFE_API_KEY: "a",
      },
    },
  );
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).boundaries).toEqual(connRows);
  expect(r.stderr).toContain("送った 3 か所、取り置きを使った 0 か所");
});
