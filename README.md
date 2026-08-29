# webapp-blueprint

新しい webapp プロジェクトを始めるとき、**clone してドメインを足すだけで、規約が機械強制された状態から書き始められる**テンプレートです。

テンプレートが運ぶのは技術選定そのものではなく、**規約をどこに置き・何で強制し・何をレビューに残すかを決める手続き**です。設計の経緯・トレードオフの全体は [docs/plan/Template/20260807_template-design.md](docs/plan/Template/20260807_template-design.md) を正本とします。このファイルはその要約ではなく、clone した直後に何をするかの手引きです。

## clone 後にすること

coding agentに「`bootstrap-template` skillでこのprojectを初期化して」と依頼してください。

この初期化には、project briefを対話で具体化し、一次資料を調査できる`grill-with-docs` skillが必要です。
coding agentから利用できない場合、bootstrapは代替interviewへ暗黙に切り替えず、開始前に停止します。

`bootstrap-template`は、最初に作りたいものを確認し、research、技術discussion、依存順の質問を終えてから、
選択したstackだけをmaterializeします。質問が完了する前にtemplateの既定値で実装を始めません。

bootstrap完了時に、この案内はproject固有の`setup-project` skillへの案内へ置き換わります。

縦切りはフロントエンドとバックエンドを配線していません（契約層を選ぶ前に片方に固定させないため）。フロントの API 接点は `apps/web/src/lib/api/` に閉じており、契約層を選んだ時点でこの中身だけが置き換わります。

## 三層構造

規約を寿命の違いで 3 層に分けています。三層が同じことを書かないことが最重要制約です（リンクの向きは 原則層 → レシピ層 → 実体層 の一方通行）。

| 層       | 場所                                                      | 内容                                                       | 寿命                 |
| -------- | --------------------------------------------------------- | ---------------------------------------------------------- | -------------------- |
| 原則層   | [docs/principles/](docs/principles/)                      | ツール名を書かない。「何が満たされていれば準拠か」だけ     | 数年                 |
| レシピ層 | [docs/recipes/](docs/recipes/)                            | 「今それをどのツールでどう満たしているか」。バージョン込み | 数ヶ月・差し替え前提 |
| 実体層   | repo root の設定・スクリプト（[mise.toml](mise.toml) 等） | レシピ層の現在の具現化                                     | レシピと同時に動く   |

規範ファイルは [AGENTS.md](AGENTS.md) が正本です（[CLAUDE.md](CLAUDE.md) はその 1 行 import）。持つ節・行数上限・更新規則は AGENTS.md 自身と `docs-triage` skill を参照してください。

## ドキュメントを検索する

`docs/` は [blume](https://useblume.dev) でローカル閲覧・検索できます（デプロイはしません。認証を掛けられない Ask AI エンドポイントを持つため）。

```sh
mise run docs:dev
```

さらに `.mcp.json` に blume の docs MCP サーバを登録済みです。**追加設定なしに、clone した時点でエージェントから `docs/` を検索できます。**

## PR 自動レビューを有効化する

`.github/workflows/pr-review-claude.yml` と `pr-review-codex.yml` を同梱していますが、clone直後は両方とも
明示的にdisabledです。`bootstrap-template`の質問でnone / Claude / Codex / bothを選び、有効化した
providerだけに認証情報を設定します。

- Claude 側: Actions Secrets に `ANTHROPIC_API_KEY`（または `CLAUDE_CODE_OAUTH_TOKEN`）を登録する
- Codex 側: Actions Secrets に `OPENAI_API_KEY` を登録する

credential未設定をdisabled状態の代わりに使いません。有効化したworkflowでcredentialが不足していれば
認証エラーとしてfail fastします。

## secrets の扱い

`.env.example` に置くのは `op://vault/item/field` 形式の参照だけです。実値は 1Password（`op run` / `op inject`）から実行時に注入し、`.env` の実ファイルは作りません。詳細は [docs/principles/secrets-by-reference.md](docs/principles/secrets-by-reference.md) を参照してください。
