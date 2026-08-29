# レシピ: PR ごとの preview 環境

原則: [`docs/principles/one-command-verification.md`](../principles/one-command-verification.md)(検証は1コマンド)、[`docs/principles/extension-adds-files.md`](../principles/extension-adds-files.md)(拡張はファイルの追加で表現される)

実体層には配線しない。複数アプリ(`apps/web` / `apps/api`)が増え、PR ごとに動作確認したい要求が出た時点でこのレシピを見て導入する。

## 構成: reusable workflow 1 本 + 各アプリの薄いラッパー

deploy / preview / cleanup を **1 本の reusable workflow** に一元化し、各アプリの workflow はそれを呼ぶだけの薄いラッパーにする。

```
.github/workflows/
  _reusable-preview.yml     deploy / preview URL 発行 / cleanup の実処理(1本)
  preview-web.yml           apps/web 用ラッパー(path フィルタ + 入力のみ)
  preview-api.yml           apps/api 用ラッパー(path フィルタ + 入力のみ)
```

各ラッパーが持つのは次の 2 つだけ:

1. **path フィルタ**: そのアプリのディレクトリ配下が変更された PR だけで起動する
2. **reusable workflow への入力**: アプリ名・デプロイ先の識別子など、アプリごとに異なる値だけを渡す

デプロイの実処理(ビルド・アップロード・preview URL の PR コメント投稿・PR クローズ時のクリーンアップ)は reusable workflow 側にしか書かない。ラッパーを増やす(= アプリを追加する)たびに実処理をコピーすると、実処理の変更が複数箇所に散らばり、原則8(検証は1コマンド。ロジックの二重管理を禁止)と同じ問題が preview 環境の運用にも起きる。アプリが増えることは「ファイルの追加」(新しいラッパー workflow 1 つ)で表現され、実処理を書き換える必要はない(原則7)。

## cleanup を必ず持つ

PR がクローズ・マージされたとき、対応する preview 環境を削除する job を reusable workflow に含める。削除を持たないと、preview 環境がクラウド上に残り続け、インフラのコストと管理対象が PR 数に比例して増え続ける。

## 秘密の扱い

デプロイ先の資格情報は原則9(秘密は参照だけを置く)に従う。preview 用のデプロイ資格情報を workflow の `env:` に直書きしない。クラウドランタイムへのデプロイであれば鍵レス(Workload Identity Federation 等)を優先し、それが使えない場合のみ 1Password 経由の参照を workflow に持たせる。

## 落とし穴

- path フィルタを付け忘れると、無関係な変更(例: `docs/` のみの変更)でも全アプリの preview が起動し、クラウドコストと待ち時間が増える
- cleanup job の起動条件を `pull_request: types: [closed]` に絞り忘れると、preview を消すタイミングを取り違える(open のたびに消してしまう、または一切消えない)
