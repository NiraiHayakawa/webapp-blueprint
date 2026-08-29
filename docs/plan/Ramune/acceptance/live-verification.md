# 実地検証仕様・結果: ramune 並列実行ライフサイクル

- 対象: `mise run mcp:ramune:serve`（HTTP サーバ: http://localhost:8642/mcp）
- 検証方式: MCP クライアント経由で全ライフサイクルを駆動し、`mise run check` による実検証を実施

## 検証マトリクス

| 検証項目                                                                       | 検証結果                                                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| サーバ起動（依存 bootstrap 込み。ADR 0004）                                    | ✅ 依存関係の自動 install 経由で起動                                              |
| 二重起動の排他（ADR 0013）                                                     | ✅ 所有検査により生存 pid 明示 + HTTP 接続の案内つきで拒否                        |
| `ramune_claim_ready(limit=2)` の原子的同時 claim                               | ✅ 2 fence が単一トランザクションで発番                                           |
| 実行中ノード存在時の `ramune_apply_ops` 拒否                                   | ✅ `GraphHasActiveNodesError` による拒否                                          |
| 並列 worktree での編集 → `submit_candidate` ×2                                 | ✅ 各隔離 worktree からの candidate 提出受理                                      |
| 使用済み fence の再利用拒否                                                    | ✅ `not_running` の型付きエラーで拒否                                             |
| 直列統合 → `publishCandidate`（CAS）→ success                                  | ✅ canonical ブランチへの fast-forward 反映                                       |
| merge conflict → cleanup → `record_integration_outcome(conflict)`              | ✅ 解消ノード R（`purpose: conflict_resolution`, `resolves: <nodeId>`）の機械挿入 |
| R の統合成功による chain 閉包                                                  | ✅ R と元ノード C が同時に done に遷移（`conflict_resolved` / `integrated`）      |
| `verification_failed` → resolution 付き reopen（canonical clean 観測）→ 再統合 | ✅ resolution 必須 reopen 後の再 claim・再統合フローが正常動作                    |
| `ramune_end`（end boundary の自動 done 含む）                                  | ✅ 全タスク完了後の非稼働化と end boundary の done 遷移                           |
| worktree / `ramune/workspace/*` ブランチの回収                                 | ✅ 全作業領域・ブランチの回収、`git status` clean                                 |

## 検証失敗時の回復フロー仕様（§7）

統合検証コマンド（`mise run check`）が失敗した場合、以下の一連の手順で安全に回復する。

1. 失敗が隠蔽されずに `verification_failed` blockage としてグラフへ記録される。
2. 理由・証跡を含む resolution を付与してノードを `reopen` する（canonical clean が前提条件）。
3. 再度 `ramune_claim_ready` でノードが割り当てられ、修正・再提出・再統合が実行される。

## 並列ノード挿入仕様（ADR 0014）

単一の先行ノードから複数の並列後続ノードを生成する操作として `insert_parallel_node` を提供する（[ADR 0014](../../adr/0014-insert-parallel-node.md)）。
