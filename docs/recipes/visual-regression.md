# レシピ: 視覚回帰(スクリーンショット差分)

原則: [`docs/principles/enforce-with-machines.md`](../principles/enforce-with-machines.md)(規約は機械で縛る)

実体層には配線しない(clone 直後は動かない)。必要になった時点でこのレシピを見て導入する。

## 課題と解決策: プラットフォーム差異への対処

視覚回帰テストを導入する際によく直面する課題は、開発環境と CI 環境のプラットフォーム差異である:

- Playwright のスクリーンショット baseline のファイル名にはプラットフォーム名が入る
- 開発機(darwin/macOS)で `--update-snapshots` して生成した baseline は、CI(linux)には存在しないファイル名になる
- 結果、CI 上では「baseline が無いので比較しようがない」silent no-op か、baseline を無理に linux 用に作らない限り恒常的に赤くなるかのどちらかになりやすい

この問題は、**baseline を最初から CI(linux)自身で生成する**ことで解決できる。開発機で生成した baseline を持ち込まないことで、「baseline のプラットフォームと比較実行のプラットフォームが一致しない」という原因そのものを構造的になくす。

導入条件は 1 つ: **「Linux CI で baseline を生成・commit するパイプラインを持てるか」**。持てないなら、このレシピは導入しない方がよい(プラットフォーム差異による silent no-op や恒常的な失敗に戻るため)。

## ツール

`@playwright/test`(1.62.1、`pnpm-workspace.yaml` の catalog で既に完全 pin 済み)の `toHaveScreenshot()` をそのまま使う。追加の視覚回帰専用ツール(Percy・Chromatic 等の SaaS)は導入しない。ローカル専用の運用方針(blume と同じ理由: 外部 SaaS への送信を増やさない)と、依存を増やさない方針(原則10)の両方に沿うため。

## 手順: 3 つの workflow に分ける

視覚回帰は「baseline を作る」「baseline とズレていないか検知する」「意図した変更を baseline に反映する」という 3 つの異なるタイミングを持つ。1 つの workflow に混ぜると、意図した変更で更新したはずの baseline が次の実行で再び「差分あり」として検知されるような事故が起きる。

| workflow      | トリガー                                           | やること                                                                                                                          |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| baseline 生成 | 初回導入時 / baseline が存在しない対象が増えたとき | CI(linux)上で `playwright test --update-snapshots` を実行し、生成した baseline を commit する                                     |
| 検知          | 定期実行(スケジュール)                             | CI(linux)上で `playwright test`(既存 baseline との比較のみ)を実行する。差分があれば失敗させ、差分画像をアーティファクトとして残す |
| baseline 更新 | 手動トリガー(`workflow_dispatch`)                  | 意図した見た目の変更があったとき、`--update-snapshots` を再実行し、更新後の baseline を commit する PR を作る                     |

検知 workflow を `mise run check`(受入条件1 の対象)には含めない。視覚回帰はコード変更ごとに毎回走らせるものではなく、定期的にドリフトを検知する仕組みとして持つ。E2E を main マージ時のみに回す運用(`docs/plan/Template/20260807_template-design.md` §5)と同じ発想である。

## 落とし穴

- 検知 workflow が「意図した変更」を自動で吸収してしまう設計(差分を検知したら自動で baseline を上書きする)にすると、視覚回帰が機能しなくなる。検知と更新は必ず別トリガーに分ける
- フォントレンダリングやアニメーションのタイミング差でノイズが出やすい。Playwright の `maxDiffPixelRatio` / アニメーション無効化オプションを使い、ノイズと実際の変更を区別できる閾値を導入時に決めておく
