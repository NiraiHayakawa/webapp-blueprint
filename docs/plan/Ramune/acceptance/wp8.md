# WP8 検証・受入仕様書: 並列シナリオの公開契約テストと全ゲート検証

- 対象: `tools/ramune/mcp-server/test/`（統合シナリオ）、`tools/ramune/graph/`、`tools/ramune/mcp-server/`、`tools/ramune/viewer/`、`tests/policy/`
- 設計正本: [20260824_parallel-execution.md](../20260824_parallel-execution.md) §12、指示書 [20260824_parallel-execution-work-packages.md](../20260824_parallel-execution-work-packages.md)「WP8」節

## 統合シナリオ・公開契約テスト仕様

設計正本 §12 に従い、MCP クライアント経由で以下の並列シナリオおよび契約を検証する。

1. **claim の原子性**: 同一グラフへの連続 claim が同じノードを返さない。
2. **stale fence 拒否**: assignmentId 不一致・旧 epoch・旧 runId の完了報告が型付きエラーで拒否される。
3. **独立 Worker の並行実行**: 独立な 2 Worker の完了報告が両方保存され、lost update が発生しない。
4. **`integrating` 高々 1 件の invariant**: 複数ノードの並行統合が排他され、publish 前提条件が全経路で検査される。
5. **integration conflict と chain 閉包**: conflict 時に C が blocked(integration_conflict) になり解消ノード R が機械挿入される。R の統合成功時に R と C（chain）が同時に done になる。
6. **abandon 照合決定則**: 統合中のプロセス停止時、Git 観測結果に基づき 3 分岐（publish 済み → done、未着手 clean → awaiting_integration、確定不能 → integration_state_uncertain）で安全に状態が確定する。
7. **`ramune_resume` による epoch 隔離**: セッション再開時に epoch がインクリメントされ、以後の旧 epoch からの書き戻しが拒否される。
8. **実行中ノード存在時の busy gate**: running / awaiting_integration / integrating ノードが存在する間の `ramune_apply_ops` および `ramune_end` が拒否される。
9. **HTTP サーバ二重起動の排他**: 同一ポートでの二重起動が port bind 失敗で即死する。

## 変更ファイル一覧

### 新規ファイル

| ファイル                                                                                                                                                                  | 内容                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `tools/ramune/graph/src/boundary-nodes.ts`                                                                                                                                | start/end 境界ノード型の分離定義                                    |
| `tools/ramune/graph/src/invariants/` (allocation-ledger.ts, cross-reference.ts, fence-session.ts, structure.ts, unsafe-numbers.ts 等)                                     | 不変条件検査のモジュール分割                                        |
| `tools/ramune/graph/src/allocation-exhausted-error.ts` / `revision-overflow-error.ts`                                                                                     | トランザクションエラークラスの分割                                  |
| `tools/ramune/graph/src/operations/abandon-assignment-error.ts` / `abandon-assignment-node-variants.ts`                                                                   | abandon_assignment 内部ロジック・エラー型の分割                     |
| `tools/ramune/graph/src/operations/epoch-overflow-error.ts`                                                                                                               | セッション再開エラー型の分離                                        |
| `tools/ramune/graph/src/operations/integrating-target.ts` / `integration-outcome-blockage.ts`                                                                             | 統合処理内部型の分割                                                |
| `tools/ramune/graph/test/recovery-operations-abandon-assignment.test.ts` / `recovery-operations-resume-session.test.ts` / `integration-outcome-conflict.test.ts`          | リカバリ・競合処理のテスト分割                                      |
| `tools/ramune/graph/test/worker-operations-submit-candidate.test.ts`                                                                                                      | submit_candidate テストケースの分割                                 |
| `tools/ramune/mcp-server/src/domain-rejection.ts` / `is-errno-exception.ts` / `persist-graph-atomically.ts`                                                               | v2 ドメインエラーハンドリング・永続化ヘルパの分離                   |
| `tools/ramune/mcp-server/test/git-*.test.ts` / `git-*-support.ts` / `git-repo-steps.ts` / `store-*.test.ts` / `store-support.ts` / `integration-outcome-conflict.test.ts` | WP8 統合シナリオ（Git 連携込み）および store トランザクションテスト |
| `tools/ramune/git/test-support.ts`                                                                                                                                        | Git テストフィクスチャ                                              |

### 既存ファイルの変更

- `tests/policy/harness-bootstrap/harness-bootstrap.check.ts` / `harness-bootstrap.test.ts`: `parseMcpConfig` を export し、テスト側のアサーションを型安全化
- `tools/ramune/graph/src/**`: グラフ v2 スキーマ、不変条件検査、operations の型安全性向上およびモジュール分割
- `tools/ramune/graph/test/**`: テストケースの型安全性向上、helper 分割、SAFETY コメント整備
- `tools/ramune/mcp-server/src/**`: 13 ツールハンドラ、HTTP サーバ、エラーハンドリングの型安全性向上
- `tools/ramune/mcp-server/test/**`: 統合シナリオテスト、モック除去、非同期クリーンアップの安定化
- `tools/ramune/viewer/src/**`: グラフ v2 スキーマ対応（`graph-diagram` / `node-list` / `session-badge` / `graph-view`）

## `mise run check` ゲート検証結果

全ゲートの検証は `mise run check` で一括実行でき、各ゲートの受入基準および対応コマンドは下表の通りである。

| ゲート             | コマンド                                                     | 受入基準 / 検証結果                                                     |
| ------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| lint               | `pnpm exec oxlint --type-aware .`                            | ✅ 終了コード 0 / エラー 0 件                                           |
| fmt                | `pnpm exec oxfmt --check .`                                  | ✅ 終了コード 0 / フォーマット違反 0 件                                 |
| typecheck          | `pnpm exec turbo run typecheck`                              | ✅ 全ワークスペースパッケージで型エラー 0 件                            |
| test               | `pnpm exec turbo run test --filter='!@webapp-blueprint/e2e'` | ✅ 全ワークスペースパッケージのテストが全件通過                         |
| knip               | `pnpm exec knip`                                             | ✅ 未使用 export・未使用依存 0 件                                       |
| similarity         | `similarity-ts . --fail-on-duplicates`                       | ✅ 重複エラー 0 件（許容パターンは理由付き `similarity-ignore` で抑制） |
| check:complexity   | `codopsy analyze . --fail-on-warning --fail-on-error`        | ✅ error / warning 0 件                                                 |
| check:secrets      | `pnpm exec secretlint --secretlintignore .gitignore "**/*"`  | ✅ secret 検出 0 件                                                     |
| check:architecture | `pnpm --filter ./tools/architecture run check`               | ✅ アーキテクチャ境界違反 0 件                                          |
| test:policy        | `pnpm exec vitest run tests/policy`                          | ✅ 全 policy テスト通過                                                 |
| check:agents       | `mise run check:agents`                                      | ✅ agent 資産の drift 0 件                                              |
| check:terraform    | `tflint --chdir=infra --config=$(pwd)/.tflint.hcl`           | ✅ 静的解析エラー 0 件                                                  |
| check:workflows    | `actionlint`                                                 | ✅ workflow 構文・型エラー 0 件                                         |

## 設計判断と例外仕様

### 1. `similarity` の Type Similarity（型重複解消）

1. `tools/ramune/mcp-server/src/tools/wire.ts` の `DomainReport` が `tools/ramune/graph/src/work.ts` の `WorkReport` と構造一致していたため `DomainReport` を削除し、`@webapp-blueprint/ramune-graph` が公開する `WorkReport` を import して利用する形に統一。
2. `tools/ramune/mcp-server/test/session.test.ts`、`test/apply-ops.test.ts`、`test/integration-flow.test.ts` で重複していたワイヤ形式の fence 定義を `test/support.ts` の共有型 `AssignmentFenceWire` へ統合。

### 2. `similarity` の関数類似クラスタ（理由付き ignore）

以下の 2 件は意図的な並行構造として理由付き `similarity-ignore` コメントで抑制。

- `tools/ramune/graph/src/operations/insert-node.ts` / `record-result.ts` / `submit-candidate.ts` のノード探索関数群: 各操作固有の precondition violation 判別共用体と narrowing 先の型を保持することが契約の明確化に必要なため。
- `tools/ramune/graph/test/` のテスト類似ペア: `read_only` と `repository_change` という異なるドメインシナリオの公開契約検証であるため。

### 3. lint 抑制コメントの適用箇所

- `tools/ramune/graph/test/structural-operations.test.ts`: 未知の操作種別に対する網羅性チェックを検証するため、意図的な不正値 `{ type: "unknown_op" }` を渡す箇所に SAFETY コメントを付与して型アサーションルールを局所的に抑制。

### 4. 型定義の整理

- `tools/ramune/graph/src/nodes.ts` の `RepositoryOriginShape` は `blockage.ts` の `RepositoryOrigin` と重複していたため削除し `RepositoryOrigin` に統一。
