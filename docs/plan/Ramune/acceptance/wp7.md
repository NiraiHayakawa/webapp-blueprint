# WP7 検証・受入仕様書: agents 定義と現行規範

- 対象: `.claude/agents/`、`.claude/settings.json`、`docs/recipes/tools/ramune.md`、`AGENTS.md`「ramune モード」節
- 設計正本: [20260824_parallel-execution.md](../20260824_parallel-execution.md) §5 §6 §8 §9

## 変更ファイル一覧

| ファイル                       | 種別     | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/settings.json`        | 変更     | PreToolUse matcher を設計正本 §8 の 13 ツール + `Edit` + `Write` に置き換え（下表参照）。hook 起動 command は不変                                                                                                                                                                                                                                                                                                                                                                                          |
| `.claude/agents/integrator.md` | **新設** | frontmatter `name: integrator` / `model: sonnet`、tools は Read / Grep / Glob / Bash + `Agent`(advisor) + `ramune_read_graph` / `ramune_advance_integration` / `ramune_record_integration_outcome` / `ramune_request_replan`。本文は §6.2 の工程を、実装レベルの正である [wp6.md](wp6.md)「API 仕様と Integrator 手順」へのリンク中心で記述                                                                                                                                                                |
| `.claude/agents/worker.md`     | 書き直し | `ramune_next_node` を外し `ramune_submit_candidate` を追加。claim 済み assignment(fence) を渡されて起動される前提、read_only は `record_result` / repository_change は隔離 worktree 内で candidate 作成→`submit_candidate`（提出で Worker の仕事は終わり）、canonical や他 worktree を編集しない規範（ADR 0011）を追記                                                                                                                                                                                     |
| `.claude/agents/planner.md`    | 書き直し | `ramune_next_node` を削除。apply_ops が実行中ノード（running / awaiting_integration / integrating）存在時に丸ごと拒否されること、reopen は resolution 必須（ADR 0007）、conflict 解消ノード R はサーバが機械挿入するもので Planner が作らないこと（ADR 0012）、`integration_conflict` / `integration_state_uncertain` の reopen 禁止、ノード選択は Orchestrator の `ramune_claim_ready` であることを追記                                                                                                   |
| `docs/recipes/tools/ramune.md` | 書き直し | ロール表（Orchestrator / Planner / Worker / Integrator のロール名と責務。ツール列は持たない）新設。monorepo 配置表に `tools/ramune/git` 追加・mcp-server 行を 13 ツールに更新。稼働判定を `session.state` に読み替え＋worktree cwd からの canonical locator 解決（§9）と v1 形拒否を追記。サーバ起動を `mise run mcp:ramune:serve`（単一共有 HTTP、port bind 排他。ADR 0013）へ更新。v1 グラフの扱い（`archiveUnsupportedVersion` 案内）を現在形で追加。決定理由は書かず ADR 0010〜0013 と設計正本へリンク |
| `AGENTS.md`                    | 変更     | 「ramune モード」節を最小限更新（Planner / Worker / Integrator の 3 役表現、`session.active` → canonical graph の `session.state`、レシピへの誘導文）。薄さは維持。「現在の状態」の ramune 行に integrator.md を追加                                                                                                                                                                                                                                                                                       |

## PreToolUse matcher の新旧

|     | ツール名                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧  | `ramune_read_graph` / **`ramune_next_node`** / `ramune_apply_ops` / `ramune_record_result` / `ramune_request_replan` / `ramune_start` / `ramune_end` + `Edit` + `Write`                                                                                                                                                                             |
| 新  | `ramune_read_graph` / `ramune_claim_ready` / `ramune_record_result` / `ramune_submit_candidate` / `ramune_claim_integration` / `ramune_advance_integration` / `ramune_record_integration_outcome` / `ramune_request_replan` / `ramune_abandon_assignment` / `ramune_resume` / `ramune_apply_ops` / `ramune_start` / `ramune_end` + `Edit` + `Write` |

差分: `ramune_next_node` を削除（互換エントリなし。呼ぶと policy.ts の UnknownToolError → fail-closed deny になる）。13 MCP ツール + Edit + Write の構成は `tools/ramune/hooks/src/policy.ts` のツール集合と 1:1 で一致する。

## テスト・検証結果

| 検証        | コマンド                                                                                           | 結果                       |
| ----------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| format      | `pnpm exec oxfmt .claude/settings.json .claude/agents/*.md docs/recipes/tools/ramune.md AGENTS.md` | 違反 0                     |
| agents 同期 | `mise run sync:agents` → `mise run check:agents`                                                   | drift なし（6 件検証通過） |

## 設計正本・指示書からの逸脱と理由

1. **ADR 0010〜0013 の状態**: 提案中から承認済みへの更新は全 WP の統合完了時に実施する。
2. **planner.md の `model: opus`**: 既存の選定を維持。
3. **integrator.md の tools に `Agent` を含めた**: advisor 相談用（ADR 0008）。Edit / Write は持たせない（Worker 専用。merge conflict の解消は機械挿入された解消ノード R を Worker が担うため）。
4. **`docs/recipes/tools/ramune.md` の「経緯: RAMUNE_MODE から書き換えたか」節**: ADR 0003 へリンクした決定ログとして維持。本文の稼働判定は `session.state` ベースに全面更新済み。
5. **手順の複製は wp6.md へ委譲**: integrator.md 本文には §6.2 工程の役割レベルの要諦のみを書き、Git 操作・関数列・証跡の作り方の正本は `docs/plan/Ramune/acceptance/wp6.md`「API 仕様と Integrator 手順」への参照とする（docs-triage の「正本 1 箇所 + リンク」原則）。
6. **`mise run mcp:ramune:serve` と http transport の記述**: 設計正本 §5 の契約を正として記述。
7. **`sync:agents` のスコープ**: scripts/sync-agent-assets.mjs は `.claude/skills/` → `.agents/skills/` のみを同期対象とする。

## ロール定義・ドキュメント構成仕様

- `docs/recipes/tools/ramune.md`「ロール」節はロール名と責務の 2 列構成とし、権限の定義は `policy.ts`（設計正本 §8 の表）を参照する形に一元化。
