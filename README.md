# tsunagari

日本語の Markdown の文章で、前の文から話がつながっていない所を見つけるコマンドラインの道具です。隣り合う文の境目ごとに、つながるかどうかのスコアを出します。

直す文の案は出しません。どこを直すかは書く人が決めます。

## 入れ方

Node 24 以上が要ります。

```sh
npm i -g tsunagari
```

判定は既定で、この PC の上で動く BERT のモデルが行い、文章を外に送りません。Windows と Mac は GPU があれば GPU で動き、無ければ CPU で動きます。モデルの重みは、最初の判定のときに Hugging Face から自動で取得します。

Linux(WSL を含む)で NVIDIA の GPU を使うときは、一度だけ `tsunagari init` を打ち、使用許諾に同意して CUDA のライブラリを取ります(保存 995 MiB)。打たなければ CPU で動き、境目 200 か所で約 30 秒かかります(GPU なら約 4 秒)。スクリプトからは `tsunagari init --accept-nvidia-eula` で取れます。`init` は決定モデル jev の鍵の置き場所も案内します。

## 使い方

```sh
tsunagari draft.md
```

標準出力に 1 行の JSON を出します。読みやすく改行すると次の形です。

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

`boundaries` の 1 つの要素が 1 つの境目で、スコアの低い順に並びます。`line` は後ろの文が始まる行の番号です。スコアは 0 から 1 までの値で、低いほど前の文とのつながりが弱いという判定です。

つながりの弱い文に色の線を引いた本文を見るときは、HTML を書き出します。

```sh
tsunagari draft.md --html result.html
```

判定に使うモデルは `--provider` で 2 つから選べます。既定の `bert` のほかに、TypeSafe という会社の言語モデル `jev` が使えます。`jev` は文章を TypeSafe に送り、利用料がかかります。

`jev` を使うときは TypeSafe のサイト(typesafe.ai)で API の鍵を取得し、環境変数 `TYPESAFE_API_KEY` に入れるか、`~/.config/tsunagari/decision.env` に `TYPESAFE_API_KEY=<鍵>` の行を書きます。Mac と Linux では、ファイルを書いたら `chmod 600 ~/.config/tsunagari/decision.env` を打ち、ほかのユーザーが鍵を読めないようにします。

```sh
tsunagari draft.md --provider jev
```

| 引数 | すること |
| --- | --- |
| `--html <out.html>` | 色付きの結果を HTML に書き出す |
| `--include-lists` | 箇条書きの項目と項目の境目も判定する |
| `--provider bert,jev` | 判定に使うものを選ぶ。既定は `bert` |
| `--connectives` | 接続詞やつなぎの言葉が前後の関係に合っているかを `jev` で判定する。鍵と利用料は `jev` と同じ。スコアは `scores` の `jev` に入る |
| `--dry-run` | 判定せず、選んだモデルに送る量と費用の見積もりを出す。`bert` の費用は 0 |
| `--max-usd <額>` | `jev` に使う費用の上限を決める |
| `--version` | 入っているバージョンを出す |

`--provider bert,jev` のように 2 つ選ぶと、`scores` に両方のスコアが入り、`correlations` に 2 つの順位の相関が入ります。

終了コードは次のとおりです。

| コード | 意味 |
| --- | --- |
| 0 | 判定できた |
| 2 | 使い方の誤り |
| 3 | 判定できなかった。標準出力は空になる |

## 入るものと確かめ方

npm の配布物には、実行に要る依存を間接のものまで含めて 24 個同梱しています。発行のときに確かめたバージョンがそのまま入り、入れるときに別のバージョンへ替わることはありません。

依存の `onnxruntime-node` は、Linux の x64 に入れるときに NuGet から CUDA のライブラリ(約 245 MB)をハッシュの照合なしで取る処理(postinstall)を持っています。tsunagari の配布物では、同梱する `onnxruntime-node` の `package.json` からこの処理を消しているので、`npm i -g` は何も取りません。上流との違いはこの 1 か所だけです。GPU のライブラリは `tsunagari init` が同意を得たうえで SHA-256 を照合して取り、モデルの重みも最初の判定のときに SHA-256 を照合して取ります。

発行は GitHub Actions の Trusted Publishing で行うので、発行に使う長期の鍵はありません。発行した tarball は、発行のときに同梱の依存の全ファイルを `npm ci` の結果と比べています。npm の署名は次のように確かめます。`npm audit signatures -g` は動かないので、一時のディレクトリに tsunagari を入れて `npm audit signatures` を打ちます。最後の行は、同梱の `onnxruntime-node` に postinstall が無ければ `undefined` を出します。

```sh
npm init -y
npm i --ignore-scripts tsunagari
npm audit signatures
node -p "require('./node_modules/tsunagari/node_modules/onnxruntime-node/package.json').scripts?.postinstall"
```

`npm audit signatures` が見るのは registry の署名と attestation で、入ったファイルの中身は照合しません。attestation が無くても失敗はしません。どのリポジトリのどのコミットから作られたかは、npmjs.com の Provenance の表示で見られます。`npm view tsunagari dist.attestations` では attestation の有無だけが分かります。同梱する依存 24 個のうち、attestation があるのは 5 個です。

同梱した 24 個の名前・バージョン・ライセンスは、発行した版の GitHub Release に付けた部品表(CycloneDX の SBOM、`tsunagari-<版>.cdx.json`)で見られます。脆弱性の報告の窓口と、配布物に問題が見つかったときの対応は [SECURITY.md](SECURITY.md) にあります。

## Web のページ

お試しとして、ブラウザの中で同じ BERT を動かす[ページ](https://tsunagari.scrapbook.workers.dev)もあります。貼った文章は外に送りません。ページが使う重みはブラウザの中に保存します。

## 開発

```sh
npm ci
npm run build
npm test
```

不具合の報告や要望は、GitHub の issue で受け付けます。

## ライセンス

[Apache License 2.0](LICENSE) です。npm の配布物に同梱する `onnxruntime-node` のバイナリ(`DirectML.dll` を含む)は別の条件で、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります。

既定の重みは [tohoku-nlp/bert-large-japanese-v2](https://huggingface.co/tohoku-nlp/bert-large-japanese-v2) を微調整したもので、出どころとライセンスは[モデルカード](https://huggingface.co/i-shinya/tsunagari-bert-onnx)にあります。
