# tsunagari

日本語の Markdown 文書から、前の文とのつながりが弱い箇所を見つける CLI ツールです。隣り合う文の境目ごとに、つながりの強さを 0〜1 のスコアで出力します。

```sh
npm install -g tsunagari
tsunagari draft.md --html result.html
```

修正案は出力しません。スコアが低い箇所を見て、どこをどう直すかは書き手が判断します。

## 特徴

- 既定の判定は、手元の PC で動く BERT モデルが行います。文章を外部に送信せず、費用もかかりません
- 結果を 1 行の JSON で標準出力に出すので、スクリプトから利用できます
- `--html` を指定すると、つながりが弱い文に色の線を引いた本文を HTML に出力します
- インストールせずに試せる [Web 版](https://tsunagari.scrapbook.workers.dev)があります

## 動作環境

Node.js 24 以上が必要です。BERT モデルの推論は OS ごとに次の環境で動作します。

| OS | CPU | 実行環境 |
| --- | --- | --- |
| Windows | x64 | DirectML(GPU)。GPU がなければ CPU |
| Linux(WSL を含む) | x64 | NVIDIA の GPU で CUDA。CUDA を `tsunagari init` で導入しなければ CPU |
| macOS | Apple Silicon | WebGPU(GPU)。GPU が使えなければ CPU |
| macOS | Intel | 非対応 |
| Windows / Linux | arm64 | 未検証 |

Intel の Mac に対応していないのは、依存する `onnxruntime-node` に Intel の Mac 向けのバイナリがないためです。GPU での推論に失敗した場合は、理由を標準エラー出力に出し、CPU ですべてやり直します。

## インストール

```sh
npm install -g tsunagari
```

モデルの重みは、初回の判定時に Hugging Face から自動でダウンロードし、`~/.cache/tsunagari/` に保存します。

### NVIDIA の GPU を使う(Linux)

Linux(WSL を含む)で NVIDIA の GPU を使う場合は、最初に一度だけ次のコマンドを実行します。

```sh
tsunagari init
```

NVIDIA の使用許諾に同意すると、CUDA のライブラリをダウンロードし、ディスクに 995 MiB を保存します。実行しない場合は CPU で動作します。境目 200 か所の判定にかかる時間は、CPU で約 30 秒、GPU で約 4 秒です。スクリプトから実行する場合は、`tsunagari init --accept-nvidia-eula` で同意の確認を省略できます。

`tsunagari init` は Windows と macOS でも実行できます。検出した OS と GPU を表示し、重みを先にダウンロードするかを確認します。後述の「別のモデルを使う」で必要な API キーの保存場所も表示します。

## 使い方

```sh
tsunagari draft.md
```

標準出力に 1 行の JSON を出力します。整形すると次の形です。

```json
{
  "version": "0.1.0",
  "providers": ["bert"],
  "boundaries": [
    { "line": 12, "scores": { "bert": 0.12 }, "prev": "前の文", "next": "後ろの文" }
  ],
  "correlations": []
}
```

`boundaries` の各要素が 1 つの境目で、スコアの低い順に並びます。`line` は後ろの文が始まる行番号です。スコアが低いほど、前の文とのつながりが弱いと判定されたことを表します。

### HTML に出力する

本文に色の線を引いた結果を見るには、HTML に出力します。

```sh
tsunagari draft.md --html result.html
```

### 別のモデルを使う

判定に使うモデルは `--provider` で選択できます。既定の `bert` のほかに、TypeSafe 社の言語モデル `jev` を使えます。`jev` を使うと文章が TypeSafe に送信され、利用料金がかかります。

`jev` を使うには、TypeSafe のサイト(typesafe.ai)で API キーを取得します。API キーは環境変数 `TYPESAFE_API_KEY` に設定するか、`~/.config/tsunagari/decision.env` に `TYPESAFE_API_KEY=<API キー>` の形式で記述します。macOS と Linux では、ファイルを作成したあとに `chmod 600 ~/.config/tsunagari/decision.env` を実行し、ほかのユーザーから読めないようにしてください。

```sh
tsunagari draft.md --provider jev
```

`--provider bert,jev` のように 2 つ指定すると、`scores` に両方のスコアが入ります。`correlations` には、境目を `bert` と `jev` のそれぞれのスコアで並べた順位の相関が入ります。

`--connectives` を指定すると、接続詞やつなぎの言葉が前後の関係に合っているかを `jev` で判定します。`--provider` を指定しなくても `jev` を使います。

```sh
tsunagari draft.md --connectives
```

## オプション

| オプション | 説明 |
| --- | --- |
| `--html <out.html>` | 色付きの結果を HTML に出力 |
| `--include-lists` | 箇条書きの項目間の境目も判定 |
| `--provider bert,jev` | 判定に使うモデル。既定は `bert` |
| `--connectives` | 接続詞やつなぎの言葉が前後の関係に合っているかを `jev` で判定。文章を TypeSafe に送信し、API キーと料金は `jev` と同じ。既定の判定の代わりに行うため `bert` とは併用不可。スコアは `scores` の `jev` |
| `--connectives-choice` | `--connectives` のうち、文頭の接続詞を伏せた問い合わせを、入る関係を 11 の選択肢から選ぶ形にした判定。API キーと料金は `jev` と同じで、`bert` とは併用不可。スコアは `scores` の `jev`。`--connectives` とは同時に指定不可 |
| `--context <範囲>` | `jev` に渡す前後の文の範囲。既定は `full-once`。値は下の表 |
| `--bert-weights fp16\|q8` | `bert` の重み。既定は `fp16`、`q8` は軽量版 |
| `--dry-run` | 判定せず、選んだモデルに送る量と費用の見積もりを出力。`bert` の費用は 0 |
| `--max-usd <金額>` | `jev` に使う費用の上限 |
| `--version` | バージョンを表示 |

`--context` に指定できる値は次のとおりです。`jev` で判定するときだけ指定できます。

| 値 | `jev` に渡す範囲 |
| --- | --- |
| `full-once` | 文書の全文。境目をまとめて問い合わせるので、送る量が少ない |
| `full-each` | 文書の全文。`full-once` より料金が高い |
| `all` | 文書の先頭から対象の文まで |
| `s<N>` | 対象の文の前 N 文(同じ見出しの下だけ) |
| `para` | 対象の文の段落(段落の先頭の文なら前の段落も) |
| `sec` | 対象の文の見出しの下と、見出しの一覧 |
| `sec2` | `sec` と、その前の節 |
| `ctx2` | 見出し・前の 2 文・後ろの文だけ。`--connectives`・`--connectives-choice` では指定不可 |

`s<N>`・`para`・`sec`・`sec2` の後ろに `-ba` を付けると、対象の文の後ろも渡します(例: `s3-ba`)。

## 終了コード

| コード | 意味 |
| --- | --- |
| 0 | 判定に成功 |
| 2 | 使い方の誤り |
| 3 | 判定に失敗。標準出力は空 |

進捗と、終了コード 2・3 で終了したときの原因は、標準エラー出力に出します。

## 仕組み

Markdown の本文を文に分割し、隣り合う文の境目ごとにモデルに問い合わせます。既定の `bert` には前の 2 文と後ろの文の組を渡し、後ろの文が前の文から自然につながるとモデルが判定した確率(0〜1)をスコアにします。見出しをまたぐ箇所は境目にしません。箇条書きの項目間は `--include-lists` を指定したときだけ境目にします。`--connectives` のスコアは、後ろの文の接続詞やつなぎの言葉が前後の関係に合っている確率です。

## プライバシー

- `bert` は文章を外部に送信しません。ネットワークを使うのは、モデルの重みと Linux の CUDA のライブラリをダウンロードするときだけです
- `jev`・`--connectives`・`--connectives-choice` は、文章を TypeSafe に送信します
- Web 版も `bert` と同じく、貼り付けた文章を外部に送信しません。重みはブラウザ内に保存します

## トラブルシューティング

### Linux で遅い

CUDA を導入していない場合は CPU で動作します。NVIDIA の GPU があるのに導入していない場合は、標準エラー出力に `bert: GPU を使うには tsunagari init を実行してください` と表示されます。

### 終了コード 3 で終了する

原因は標準エラー出力に表示されます。`bert` の判定に失敗した場合は `bert:` で始まる行です。重みをダウンロードできない場合は、Hugging Face に接続できるかを確認してください。

### Intel の Mac で動かない

Intel の Mac には対応していません(「動作環境」を参照)。

## セキュリティ

### 同梱している依存パッケージ

npm パッケージには、実行に必要な依存パッケージを間接依存まで含めて 24 個同梱しています。公開時に `npm ci` でインストールしたバージョンがそのまま入り、インストール時に別のバージョンに置き換わることはありません。

依存する `onnxruntime-node` は、Linux x64 へのインストール時に CUDA 向けのライブラリ約 245 MB を NuGet からダウンロードする postinstall スクリプトを持っています。このダウンロードではハッシュを照合しません。tsunagari のパッケージでは、同梱する `onnxruntime-node` の `package.json` からこのスクリプトを削除しています。そのため `npm install -g` が tsunagari のパッケージ以外をダウンロードすることはありません。上流との差分はこの 1 か所だけです。

CUDA のライブラリは、`tsunagari init` が同意を得たうえで SHA-256 を照合してダウンロードします。モデルの重みも、初回の判定時に SHA-256 を照合してダウンロードします。

### 公開の方法

npm への公開は GitHub Actions の Trusted Publishing で行うため、公開用の長期トークンはありません。公開時には tarball に同梱した依存パッケージの全ファイルを `npm ci` の結果と照合しています。

### 署名の検証

npm の署名は次の手順で検証できます。`npm audit signatures -g` は動作しないため、一時ディレクトリに tsunagari をインストールして `npm audit signatures` を実行します。最後の `node -p` は、同梱の `onnxruntime-node` に postinstall スクリプトがなければ `undefined` を出力します。

```sh
mkdir tsunagari-check && cd tsunagari-check
npm init -y
npm install --ignore-scripts tsunagari
npm audit signatures
node -p "require('./node_modules/tsunagari/node_modules/onnxruntime-node/package.json').scripts?.postinstall"
```

`npm audit signatures` は registry の署名と attestation を検証し、インストールしたファイルの中身は照合しません。署名が無効なパッケージがあればエラーで終了します。attestation がなくても失敗にはなりません。どのリポジトリのどのコミットからビルドされたかは、npmjs.com の Provenance の表示で確認できます。`npm view tsunagari dist.attestations` でわかるのは attestation の有無だけです。同梱する依存パッケージ 24 個のうち、attestation があるのは 5 個です。

### SBOM

同梱した 24 個のパッケージの名前・バージョン・ライセンスは、各バージョンの GitHub Release に添付した SBOM(CycloneDX 形式、`tsunagari-<バージョン>.cdx.json`)で確認できます。

### 脆弱性の報告

脆弱性は公開の issue に書かず、[SECURITY.md](SECURITY.md) の窓口から報告してください。配布物に問題が見つかった場合の対応も、同じファイルに記載しています。

## Web 版

ブラウザ内で同じ BERT モデルを動かす [Web 版](https://tsunagari.scrapbook.workers.dev)があります。インストールせずに試せます。貼り付けた文章は外部に送信せず、重みはブラウザ内に保存します。

## 開発

```sh
npm ci
npm run build
npm test
```

不具合の報告や機能の要望は、GitHub の issue で受け付けています。

## ライセンス

[Apache License 2.0](LICENSE)

Copyright 2026 i-shinya

npm パッケージに同梱する `onnxruntime-node` のバイナリ(`DirectML.dll` を含む)には、別のライセンスが適用されます。詳細は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

既定のモデルの重みは、[tohoku-nlp/bert-large-japanese-v2](https://huggingface.co/tohoku-nlp/bert-large-japanese-v2) をファインチューニングしたものです。出典とライセンスは[モデルカード](https://huggingface.co/i-shinya/tsunagari-bert-onnx)を参照してください。
