# WP3 検証・受入仕様書: MCP ツール契約の置き換え

- 対象: `tools/ramune/mcp-server/`（`src/tools/`、`server.ts`、`index.ts`、`main.ts`、`status.ts`、`tool-definition.ts`、およびそのテスト）
- 設計正本: [20260824_parallel-execution.md](../20260824_parallel-execution.md) §8

## 実装内容

設計正本 §8 の表どおり **13 ツール**へ置き換えた。transport は stdio のまま（WP5）、
「契約 = JSON Schema そのもの、ajv 検証 → handle」という低レベル構成は維持した。

| ツール                            | 認証              | 備考                                                                                                                            |
| --------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ramune_read_graph                 | なし              | store.read()                                                                                                                    |
| ramune_start                      | なし（goal 必須） | runId をサーバーが crypto.randomUUID() で発番                                                                                   |
| ramune_claim_ready                | expected_revision | limit・base_commit 入力。workspaceId をサーバー発番し assignment へ記録（git worktree add は WP5/WP6）                          |
| ramune_apply_ops                  | expected_revision | 操作列は insert_node / reopen / abort のみ。実行中ノード存在時は GraphHasActiveNodesError で拒否。set_result はスキーマから削除 |
| ramune_record_result              | fence             | read_only 完了                                                                                                                  |
| ramune_submit_candidate           | fence             | source は current assignment からのコピー                                                                                       |
| ramune_claim_integration          | expected_revision | canonical_head_before 入力。journal（claimed）生成                                                                              |
| ramune_advance_integration        | fence             | claimed → merge_prepared → publish_prepared。verification 必須                                                                  |
| ramune_record_integration_outcome | fence             | success / conflict（機械挿入）/ verification_failed / candidate_rejected / integration_state_uncertain                          |
| ramune_request_replan             | fence             | worker_request / integration_replan_requested                                                                                   |
| ramune_abandon_assignment         | fence             | observed_git は統合段階のみ。照合決定則はドメイン層                                                                             |
| ramune_resume                     | expected_revision | integrating 存在時は拒否（integrating_node_exists）をツール応答として露出                                                       |
| ramune_end                        | なし              | running / awaiting_integration / integrating 存在時は拒否                                                                       |

共通の設計:

- **判断系 / 完了系の粒度分け（§4）**: 判断系は expected_revision を要求し、不一致は RevisionConflictError を isError 応答として返す（自動リトライなし）。完了系は fence 完全一致のみで認証する
- **エラーの表面化**: 全ドメイン前提条件違反・不変条件違反・fence / revision 不一致・UnsupportedGraphVersionError・GraphNotInitializedError 等を isError: true の text content（メッセージ本文）で返す。握り潰し・自動リトライなし。v1 ファイル検出時は自動 archive せず、メッセージが archiveUnsupportedVersion() 手順を案内する（§4 の明示操作）
- **async 化**: ToolDefinition.handle を Promise 返却へ変更。全ハンドラが store.transaction() / read() を経由する。server.ts の CallTool ハンドラも async 化
- **ワイヤ変換の一元化**: src/tools/wire.ts に snake_case ツール入力 → branded 型の変換を集約し、すべて graph パッケージ公開 zod スキーマ経由で検証する（ツールごとの検査漏れ・キャスト散在を防ぐ）

## 変更ファイル一覧

### 変更

- `src/server.ts` — 13 ツールへの登録替え、DomainRejection レジストリ拡張（graph / store / ツール層の全型付きエラー）、CallTool ハンドラの async 化
- `src/tool-definition.ts` — handle を async へ
- `src/main.ts` — initialGoal 廃止
- `src/status.ts` — GraphV2 型追随、session.state 読み、runId / epoch / revision の表示追加
- `src/index.ts` — 新エラークラス・TransactionOptions 等の export 整理
- `src/tools/{read-graph,start,end,apply-ops,record-result,request-replan}.ts` — v2 契約へ改訂

### 新規

- `src/graph-has-active-nodes-error.ts` — apply_ops の busy gate エラー
- `src/tools/wire.ts` — ワイヤ ↔ ドメイン変換（スキーマ検証込み）
- `src/tools/{claim-ready,submit-candidate,claim-integration,advance-integration,record-integration-outcome,abandon-assignment,resume}.ts`

### 削除

- `src/tools/next-node.ts`（ramune_next_node 廃止。互換エントリなし）
- 旧テスト: `test/{start,end,next-node,apply-ops,record-result,request-replan,read-graph}.test.ts`

### テスト

- 新契約テスト: `test/{session,apply-ops,worker-flow,integration-flow,integration-outcome}.test.ts`
- テスト基盤: `test/connect-test-client.ts`（callToolJson / expectDomainRejection / expectSchemaViolation ヘルパ追加）
- `test/support.ts` — セッション開始済みクライアント・task 挿入・claim ヘルパ

## テスト仕様・検証結果

検証コマンド:

```bash
pnpm --filter @webapp-blueprint/ramune-mcp-server test
pnpm --filter @webapp-blueprint/ramune-mcp-server typecheck
```

受入シナリオ対応表:

| シナリオ                             | テスト                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 連続 claim が同じノードを返さない    | worker-flow「連続 claim が同じノードを返さない」                                                                                            |
| stale fence 拒否                     | worker-flow（assignmentId 不一致）、session（resume 後の旧 epoch 書き込み拒否）                                                             |
| revision mismatch                    | apply-ops「expected_revision の不一致…」+ claim_ready の OCC テスト                                                                         |
| 実行中の apply_ops / ramune_end 拒否 | apply-ops「running ノードが存在すると…」、session「running ノードがある場合…」                                                              |
| conflict outcome での機械挿入        | integration-outcome「C が blocked(integration_conflict) になり R が機械挿入される」（deps 追記・resolves 相互参照・pending 生まれまで検証） |
| resume の integrating 拒否           | session「integrating ノードが存在するときは拒否され、abandon 照合で解消すれば resume できる」                                               |

加えて、R を通常の repository_change として claim → submit → integrate し、success で R と C が同時に done になる chain 閉包シナリオ（§6.3）を integration-outcome.test.ts で検証。

## 設計正本からの逸脱と理由

1. **ramune_claim_integration の入力に canonical_head_before を追加した**（§8 の表は expected_revision のみ）。journal.canonicalHeadBefore（§6.2/§6.4/§7 の基準値）の供給源がこれ以外に無く、サーバーが Git を観測しない本レイヤでは偽の値を入れられないため。Orchestrator（Git 観測側）の入力として必須化した。
2. **ramune_claim_integration / ramune_claim_ready が startedAt / workspaceId をサーバー内部で発番する**。診断情報（startedAt）とグラフ上の割当識別子であり、呼び出し側に渡させる意味がないため。git worktree add そのものは WP5/WP6 配線。
3. **ramune_resume の入力から reason を省いた**。§8 の表には reason があるが、保存先フィールドがグラフ契約に存在せず、受理すると黙って捨てることになるため（fail-fast）。必要になった時点で graph 契約と一緒に追加する。
4. **ツール入力の JSON を snake_case、応答のグラフ等をドメイン型のまま（camelCase）で返す**。入力はツール API 契約（既存 v1 の node_id 流儀を継承）、応答は外在化された状態そのものの dump という役割分担。変換は wire.ts 一箇所。
5. **apply_ops の busy 検査をツール層に置いた**（GraphHasActiveNodesError）。§8 がこの拒否を ramune_apply_ops ツールの契約として規定しており、ドメイン操作（個別の差分操作）の責務ではないため。
6. **advance_integration の verification.finished_at をツール入力必須にした**。検証を実行したのは Integrator であり、サーバーが時刻を作ると証跡が嘘になるため。

## transport 移行・連携仕様

- **transport 依存の分離**: ツール層は Server / InMemoryTransport / StdioServerTransport 等の抽象にのみ依存し、13 ツールの handle は transport 実装に依存しない。
- **port bind 排他（ADR 0013）**: 二重起動防止は HTTP レイヤが担う。store は単一プロセス内での複数接続（並行リクエスト）に対して transaction mutex で直列化を保証する。
- **main.ts 引数設計**: initialGoal は廃止され、引数なしで起動可能。
- **ajv は strict: true で運用**: inputSchema オブジェクトを ListTools 応答と共用する低レベル構成を維持する。
