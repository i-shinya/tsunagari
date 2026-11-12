// web/src/store.ts も読むので Node の標準を import しない

/** 重みの固定した revision。判定の取り置きの鍵にも入れる */
export const REVISION = "89838c025a1feeb148dffb52941eae510e57a312";
export const ORT_VERSION = "1.31.1";
export const HF = `https://huggingface.co/i-shinya/tsunagari-bert-onnx/resolve/${REVISION}/`;

export type Weights = "fp16" | "q8";
export const MODEL_SHA: Record<Weights, string> = {
  fp16: "8b2a5642fce5bd83f875eb63360c82644792514792e76d3d29290c3478180922",
  q8: "32401ef2ac30215c412910b15cccf260b19af2655fe01926d84f27b976aad2f9",
};
export const VOCAB_SHA =
  "5e9a696b0191b833cfdf8eefada01f41f23ccbd7e7746946864260b1cdd0a784";
export const DICT_DIR = "lindera-unidic-5.3.0";

const NUGET_NATIVE = "runtimes/linux-x64/native/";
const CUDA_LIB = "nvidia/cu13/lib/";
/** provider は onnxruntime の隣に、ほかは LD_LIBRARY_PATH の場所に置く */
export const CUDA_ARCHIVES = [
  {
    name: "ort-gpu-linux.nupkg",
    url: `https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.linux/${ORT_VERSION}/microsoft.ml.onnxruntime.gpu.linux.${ORT_VERSION}.nupkg`,
    sha: "cfb5315b87f812d8d91194075eb4aab3cbfd97a932f2b56c9bfa41e36087c4a2",
    provider: true,
    files: [
      {
        entry: `${NUGET_NATIVE}libonnxruntime_providers_cuda.so`,
        file: "libonnxruntime_providers_cuda.so",
        sha: "4aef328b5256ed7479ef268d5a2a157bbd64f691bdf78759a2b365f4348dd5d2",
      },
      {
        entry: `${NUGET_NATIVE}libonnxruntime_providers_shared.so`,
        file: "libonnxruntime_providers_shared.so",
        sha: "c6a12593396095f5670160e284c35d1700b7708cf3037b7042e2a5200ccae772",
      },
    ],
  },
  {
    name: "nvidia_cublas.whl",
    url: "https://files.pythonhosted.org/packages/04/36/c6f716dbd080fa030e6056261f238fb82c2b78d94e5074460740f61384b3/nvidia_cublas-13.8.2.12-py3-none-manylinux_2_27_x86_64.whl",
    sha: "21721774d8e7044debec3034ecc1a8cd22e173eb6dae5d7f5f8a014852382894",
    provider: false,
    files: [
      {
        entry: `${CUDA_LIB}libcublas.so.13`,
        file: "libcublas.so.13",
        sha: "c7983bdbcfc3628f9d964c6c82ca506f8f28bf29b8ab6dd9d27365a2b5a0cbca",
      },
      {
        entry: `${CUDA_LIB}libcublasLt.so.13`,
        file: "libcublasLt.so.13",
        sha: "d8d152ba3ce95fe54912894c2e8ced216f11a590bc4e61db65c20bcdb9af33be",
      },
    ],
  },
  {
    name: "nvidia_curand.whl",
    url: "https://files.pythonhosted.org/packages/12/63/636e5dc9afb2959bfc0042a357d5567358df829b66c96d9fc36d77dc0596/nvidia_curand-10.4.5.25-py3-none-manylinux_2_27_x86_64.whl",
    sha: "22bb226a857e5888fe6b54ae465fc4371296bcff13a35f79e19691bcf454f529",
    provider: false,
    files: [
      {
        entry: `${CUDA_LIB}libcurand.so.10`,
        file: "libcurand.so.10",
        sha: "82586610865e67dc73505087e04dd40a3cc69b281028731ce763faafe14b1347",
      },
    ],
  },
  {
    name: "nvidia_cuda_runtime.whl",
    url: "https://files.pythonhosted.org/packages/0b/7c/14b8f5518f8951e9dca57ea80f44f8ea8bcc8671812e6cc38009f3205e57/nvidia_cuda_runtime-13.5.37-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
    sha: "df2b79a8852f10d1fef8c848489c49eebb5754051bf870202a862831412b179d",
    provider: false,
    files: [
      {
        entry: `${CUDA_LIB}libcudart.so.13`,
        file: "libcudart.so.13",
        sha: "be114eaabb3f3251cf30b6e334be5e8c3cf1b12c0a11c17295a810dd83cc141a",
      },
    ],
  },
];
/** 解凍後の値 */
export const DICT_SHA = {
  "metadata.json":
    "7e0a11dcfc299c8056815c2ab53e348214824e9380f0e7e457bfbb01936b7d25",
  "dict.trie":
    "0adbf881e94d058114770fd91736540b8302ad4719b71f2a75108a4347821446",
  "dict.valsidx":
    "daba3721e79b27a78d65668f2672315341e42c834ef3d893d3e1d46a499c5680",
  "dict.vals":
    "268e226a3b7ce49c6a72f41e87eb359fdbc39f35d5807f11e276faf06164451f",
  "matrix.mtx":
    "877844021e97b81429972fa3bc327f9b343112ff3d19a767a582a29dd4d1e3aa",
  "char_def.bin":
    "fc47b7472f9a66bd02754d9214bd9362ca194d5d4e3326bca1c2cb0b958ce1b3",
  "unk.bin": "bb56ce6a509341e1b4ee276eda917e176684989931acac1e7f3c4f1038c481f0",
};
