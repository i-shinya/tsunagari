import { spawnSync } from "node:child_process";
import {
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
} from "@clack/prompts";
import { sibling } from "./bert.ts";
import { cudaReady, hasNvidia } from "./bert-cuda.ts";
import type { Weights } from "./bert-files.ts";

const o = { output: process.stderr };
const EULA = "https://docs.nvidia.com/cuda/eula/index.html";

function setup(weights: Weights, cuda: boolean): number {
  const r = spawnSync(
    process.execPath,
    [sibling("bert-setup"), weights, cuda ? "1" : "0"],
    {
      stdio: ["ignore", 2, 2],
      env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
    },
  );
  return r.status === 0 ? 0 : 3;
}

function detected(nvidia: boolean): string {
  if (process.platform === "win32")
    return "Windows: DirectML の GPU で動きます";
  if (process.platform === "darwin") return "Mac: CoreML の GPU で動きます";
  if (process.arch !== "x64")
    return "Linux: この CPU では CUDA を用意できないので CPU で動きます";
  if (nvidia) return "Linux: NVIDIA の GPU が見つかりました";
  return "Linux: NVIDIA の GPU が見つからないので CPU で動きます";
}

/** tsunagari init。終わり方の番号を返す */
export async function runInit(
  acceptEula: boolean,
  keyFile: string,
): Promise<number> {
  const linuxX64 = process.platform === "linux" && process.arch === "x64";
  const nvidia = linuxX64 && hasNvidia();
  if (acceptEula) {
    if (!linuxX64) {
      console.error("--accept-nvidia-eula は Linux x64 でだけ使う");
      return 2;
    }
    if (!nvidia) {
      console.error("NVIDIA の GPU が見つからないので CUDA を用意しない");
      return 3;
    }
    return setup("fp16", true);
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    console.error(
      "tsunagari init は端末で打つ。スクリプトからは --accept-nvidia-eula を付ける",
    );
    return 2;
  }
  const stop = () => {
    outro("中止しました。tsunagari init でやり直せます", o);
    return 0;
  };

  intro("tsunagari の初期設定", o);
  note(detected(nvidia), "この機械", o);

  const weights = await select<Weights | "none">({
    message: "BERT の重みを今取りますか(判定はこの PC の上で動きます)",
    options: [
      { value: "fp16", label: "標準の fp16(644 MiB)" },
      {
        value: "q8",
        label: "軽い q8(460 MiB)",
        hint: "CPU のメモリが半分。点が少し動く",
      },
      {
        value: "none",
        label: "今は取らない",
        hint: "最初の判定で fp16 を取る",
      },
    ],
    ...o,
  });
  if (isCancel(weights)) return stop();

  let cuda = false;
  if (nvidia && !cudaReady()) {
    note(
      `GPU で動かすには CUDA のライブラリを NuGet(Microsoft)と PyPI(NVIDIA)から取ります(取得 764 MB、保存 995 MiB)。${weights === "none" ? "\n動くかを確かめるために fp16 の重み(644 MiB)も取ります。" : ""}\n使用許諾: ${EULA}`,
      "CUDA",
      o,
    );
    const ok = await confirm({
      message: "NVIDIA の使用許諾に同意して取りますか",
      initialValue: false,
      ...o,
    });
    if (isCancel(ok)) return stop();
    cuda = ok;
    if (!ok)
      log.warn(
        "CUDA を取らないと CPU で動きます。境目 200 か所で約 30 秒かかります(GPU なら約 4 秒)。あとから tsunagari init で取れます",
        o,
      );
  }

  const jev = await confirm({
    message: "決定モデルの jev も使いますか(鍵と利用料が要ります)",
    initialValue: false,
    ...o,
  });
  if (isCancel(jev)) return stop();
  if (jev)
    note(
      `TypeSafe で鍵を作り、環境変数 TYPESAFE_API_KEY に入れるか、次のファイルに TYPESAFE_API_KEY=<鍵> の行を書き${process.platform === "win32" ? "ます" : "、chmod 600 で自分だけが読めるようにします"}。\n${keyFile}\n使うときは --provider jev を付けます`,
      "jev の鍵",
      o,
    );

  if (weights === "none" && !cuda) {
    outro("準備ができました", o);
    return 0;
  }
  log.step("取っています。数分かかります", o);
  const code = setup(weights === "none" ? "fp16" : weights, cuda);
  if (code !== 0) {
    log.error("取れませんでした。上の bert-error の行を見てください", o);
    return code;
  }
  outro(
    `準備ができました。${cuda ? "GPU で動きます。" : ""}${weights === "q8" ? "q8 で判定するときは --bert-weights q8 を付けます" : ""}`,
    o,
  );
  return 0;
}
