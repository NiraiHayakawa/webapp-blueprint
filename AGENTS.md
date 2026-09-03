# AGENTS.md

規範の正本。薄く保つ（このファイル自体が §7「コンテキスト予算」の実演）。
設計の正本は [docs/plan/Template/20260807_template-design.md](docs/plan/Template/20260807_template-design.md)。
このファイルはそれを要約し直さない。

## 絶対規約

機械強制できない普遍規範のみを置く。各項目は原則ファイル（要件 / 機械強制の受け皿 / レビュー観点の3節構成）へのリンクであり、詳細と「今どの機械が強制しているか」はリンク先で読む。

1. [契約が単一の真実源である](docs/principles/contract-is-ssot.md) — 実装層は再生成可能に保ち、生成物はコミットしない
2. [fail fast](docs/principles/fail-fast.md) — silent fallback・デフォルト値フォールバック・自動リトライによる隠蔽を作らない
3. [後方互換レイヤを作らない](docs/principles/no-compatibility-layer.md) — 破壊的変更は歴史的経緯の痕跡ごと消す
4. [規約は機械で縛る](docs/principles/enforce-with-machines.md) — 散文は最後の手段。抑制（lint 無効化・除外・baseline）には理由を書く
5. [決定ログと現行規範の二層](docs/principles/docs-two-layer.md) — ADR と AGENTS.md 階層を混在させない
6. [テスト対象は公開契約のみ](docs/principles/test-public-contract-only.md) — 実装詳細に依存したテストを書かない
7. [拡張はファイルの追加で表現される](docs/principles/extension-adds-files.md) — 吹き溜まり名・prefix 疑似名前空間を禁止する
8. [検証は 1 コマンド](docs/principles/one-command-verification.md) — 検査ロジックを CI 側に二重管理しない
9. [秘密は参照だけを置く](docs/principles/secrets-by-reference.md) — 実値は repo に置かず、実行時に注入する
10. [依存は完全固定する](docs/principles/pin-dependencies.md) — 新規公開バージョンには採用までの待機期間を置く
11. [知見は正本へ還流する](docs/principles/knowledge-flows-back.md) — 昇格していない machine-local な記憶は正本ではない
12. [観測できる形で作る](docs/principles/observable-by-design.md) — message はフィールドからの描画であり乖離しない。秘密はフィールドとして作らない

## ramune モード

タスクグラフ実行機構 [ramune](docs/recipes/tools/ramune.md) が稼働している間は、**Planner / Worker / Integrator の役割が hook で強制され、ツールが拒否される**。拒否理由を見て混乱しないための最小限をここに置く。

| 状態               | 入り方                                                     | 挙動                                                                                         |
| ------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 非稼働（**既定**） | 何もしない（canonical グラフが無い、またはあっても非稼働） | hook は判定を下さない。通常どおり作業できる                                                  |
| 稼働               | Orchestrator が `ramune_start` を呼ぶ                      | ロールごとにツールが制限される。稼働状態は canonical graph の `session.state` に外在化される |

**既定は非稼働**であり、`ramune_start` を呼ばない限り縛られない。`ramune_end` で非稼働に戻せる（グラフ自体は残る）。稼働中に何が誰に許されるか（Orchestrator / Planner / Worker / Integrator の 4 役と claim・統合の流れ）は [ramune のレシピ](docs/recipes/tools/ramune.md)。現在の状態は `mise run ramune:status` で確認できる。

稼働中も**全ロールが `advisor` サブエージェントに相談できる**（[ADR 0008](docs/adr/0008-advisor-by-subagent.md)）。advisor は読み取り専用なので hook の matcher に触れず拒否されない。助言は**仕様判断とゲート検証の代わりにはならない**。

## Stack 索引

契約層とレシピ層の対応表。1 行要約とレシピへのリンクのみ（原則の要約はここに書き直さない）。

| 対象                     | 状態                                    | レシピ                                                                                    |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| 契約層                   | 未選択。プロジェクト開始時に ADR で選ぶ | [docs/recipes/contract-layer/](docs/recipes/contract-layer/)（protobuf 版 / TypeSpec 版） |
| ビジュアルリグレッション | 未配線。導入時に参照                    | [docs/recipes/visual-regression.md](docs/recipes/visual-regression.md)                    |
| CI 差分実行              | 未配線。CI 所要 10 分超えで検討         | [docs/recipes/affected-ci.md](docs/recipes/affected-ci.md)                                |
| PR プレビュー環境        | 未配線。導入時に参照                    | [docs/recipes/preview-environments.md](docs/recipes/preview-environments.md)              |
| DB 統合テスト            | 未配線。導入時に参照                    | [docs/recipes/tools/database-testing.md](docs/recipes/tools/database-testing.md)          |
| ツール選定               | 新しい言語・領域に手を出すとき参照      | [docs/recipes/tools/](docs/recipes/tools/README.md)                                       |

## コマンド

正本は [mise.toml](mise.toml)。ここには入口だけを置き、手順は書かない。

| コマンド               | 内容                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `mise run install`     | 依存を lockfile どおりに揃える。MCP サーバの起動タスクが `depends` で自力で呼ぶ（[ADR 0004](docs/adr/0004-harness-bootstrap.md)） |
| `mise run check`       | 全ゲートの入口（lint / fmt / typecheck / test / knip / similarity / secrets / architecture / policy / agents / docs）             |
| `mise run test:e2e`    | playwright-bdd による E2E。`check` には含まない（main マージ時のみ実行）                                                          |
| `mise run docs:dev`    | blume の開発サーバ起動（ローカル専用。デプロイしない）                                                                            |
| `mise run sync:agents` | `.claude/skills/` を正本として `.agents/skills/` へ複製する                                                                       |

## スキル参照

正本は [.claude/skills/](.claude/skills/)。`mise run sync:agents` で `.agents/skills/` に複製し、差分があれば `mise run check` が拒否する。

- `bootstrap-template` — templateをcloneした直後、project固有コードの実装前に、research・discussion・質問・stack materializationを完了するとき
- `docs-triage` — 新しい知見・規約・手順をどこに書くか判定するとき / 既存記述を skill へ切り出すか判定するとき / このファイルのセクションを追加・更新するとき
- `adr` — 技術決定を記録するとき、既存 ADR の決定を上書き・廃止するとき、却下した代替案を残すとき
- `knowledge-promote` — machine-local な auto memory から正本へ知見を昇格したいとき、セッション終了前に引き継ぐべき知見を洗い出すとき
- `commit` — git commit を作るとき
- `pull-request` — GitHub プルリクエストを作るとき
- `advisor` — 設計の分岐で迷ったとき / 詰まったとき / 着手前に方針を確かめたいときに、より賢いモデル（Fable 5 / Opus 5）へ相談するとき

## 現在の状態

**上書き専用**（追記しない。履歴は git log と ADR が持つ）。

- 契約層: 未選択（`contract/` は空スロット。ADR で選ぶ。番号は `adr` skill が索引から採番する）
- 最小縦切り: `apps/web` `apps/api` `e2e/` に実装済み。全ゲートが噛むことを確認したら削除して始めてよい
- PR 自動レビュー: Claude / Codex workflowは同梱済みだが、bootstrapでproviderを選ぶまで明示的にdisabled
- ドキュメント MCP: `.mcp.json` に登録済み。clone 直後から `docs/` を検索できる
- ramune: 並列実行対応の v2（fenced assignment・隔離 worktree + 直列統合・単一共有 HTTP サーバ。ADR 0010〜0013）を実装済みで全ゲート green。`.mcp.json`・`.claude/settings.json`・agents 3 役（planner / worker / integrator）を配線済み。サーバは `mise run mcp:ramune:serve` で起動し、既定は非稼働（上記「ramune モード」参照）
