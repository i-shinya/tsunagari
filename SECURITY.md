# セキュリティ

## 報告の窓口

脆弱性や、配布物が改ざんされた疑いは、公開の issue に書かず、GitHub の [Report a vulnerability](https://github.com/i-shinya/tsunagari/security/advisories/new) から非公開で知らせてください。対象は npm の `tsunagari` の最新の版と、Web のページです。

## やられたときの手順

配布物に悪いものが入った、または発行の経路が乗っ取られたと分かったら、次の順で動きます。

1. 発行を止める。GitHub の Actions で `publish` の workflow を無効にし、乗っ取りが疑われるなら npmjs.com の Trusted Publisher の登録を外す
2. 当たる版を取り下げる。`npm deprecate tsunagari@<版> "<理由と、替わりの版>"` で入れる人に警告を出す。消す必要があり、npm の unpublish の条件(発行から 72 時間以内など)に合うときだけ `npm unpublish tsunagari@<版>` を使う
3. 原因を取り除き、発行の経路(リポジトリ、workflow、Trusted Publisher の登録)が元のとおりだと確かめてから、手順 1 で止めたものを戻し、直した版をいつもの `publish` の workflow で出す
4. 告知する。GitHub Security Advisory を公開し、当たる版・何が起きたか・利用者がすること(直した版に上げる、当たる版を入れた機械から消す)を書く。直した版の GitHub Release からも advisory を指す
