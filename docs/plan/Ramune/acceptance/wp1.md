# WP1 検証・受入仕様書: graph v2

- 対象: `tools/ramune/graph/`
- 設計正本: [20260824_parallel-execution.md](../20260824_parallel-execution.md) §2（グラフスキーマ v2）、§3（ready 選択の純関数化）、§4（allocator / revision）、§8（操作公開契約）

## 実装内容

設計正本 [20260824_parallel-execution.md](../20260824_parallel-execution.md) §2（グラフスキーマ v2）、§3（ready 選択の純関数化）、§4 のグラフ層側（allocator / revision）、§8 のうち操作の公開契約に対応する部分を実装した。

- branded type 全面採用。`Brand<T, Name>` は zod v4 の `.brand<>()` 出力（`T & $brand<Name>`）と同じ形で宣言し、手書き TS 型と zod スキーマ出力型が構造的に一致する。一致の裏取りは `parseGraph` の戻り値型検査（v1 と同じ仕組み）
- 全 object / union branch を strict にし、未知キーは拒否（v1 の looseObject 方針は廃止）
- `version: 2` 固定。`version !== 2` は parse の段階で拒否される
- 永続 allocator（`nextAllocationId`）を導入し、assignmentId / conflictId / blockageId / 機械生成ノード ID（`gen-<n>`）を発番。overflow は fail-closed（`AllocationExhaustedError` / `RevisionOverflowError`）
- 1 操作 = 1 transaction = revision +1。操作列（`ramune_apply_ops` 相当）は列全体で +1
- 不変条件は §2.8 の一覧を実装（数値の safety、allocator 台帳、ID 一意・deps 整合・サイクル、live fence と session の完全一致、integrating 高々 1 件、candidate.source の整合、C↔R 相互参照 1 対 1）
- `selectNextNode` を削除し、宣言順で最大 N 件選ぶ純関数 `selectReadyNodes` に置換（遷移は operations 側）
- `persisted-graph.ts` は `session.state` を読む形へ更新。依存ゼロの性質は維持（ADR 0004）

### operations（13 種）

| 操作                       | ファイル                                 | 契約                                                                                                                                                                              |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| insert_node                | operations/insert-node.ts                | Planner の構造操作。newNode の effect を指定。予約 ID・生成名前空間を拒否                                                                                                         |
| reopen                     | operations/reopen.ts                     | 対象は blocked のみ。resolution 必須で ResolutionRecord 追記。integration_conflict / state_uncertain は禁止。verification_failed は canonical clean 観測必須。done カスケード維持 |
| abort                      | operations/abort.ts                      | pending / done / blocked → aborted（payload は落とす）                                                                                                                            |
| start_session              | operations/start-session.ts              | runId 入力。epoch 0 で稼働化。start boundary を done に                                                                                                                           |
| end_session                | operations/end-session.ts                | running / awaiting_integration / integrating があれば拒否。非稼働化。deps 揃えば end を done に                                                                                   |
| claim_ready                | operations/claim-ready.ts                | 選択＋fence 発番を同一 transaction で。worktree プールを宣言順に消費                                                                                                              |
| record_result              | operations/record-result.ts              | read_only のみ。fence 完全一致。completedBy 付きの結果                                                                                                                            |
| submit_candidate           | operations/submit-candidate.ts           | fence 完全一致。source はサーバコピー（assignment から構築）                                                                                                                      |
| claim_integration          | operations/claim-integration.ts          | awaiting_integration ＆全 deps done を宣言順で 1 件。journal（claimed）生成                                                                                                       |
| advance_integration        | operations/advance-integration.ts        | claimed → merge_prepared → publish_prepared の順序強制。verification の commit 一致検査                                                                                           |
| record_integration_outcome | operations/record-integration-outcome.ts | success（chain 同時 done）/ conflict（機械挿入）/ verification_failed / candidate_rejected / integration_state_uncertain                                                          |
| request_replan             | operations/request-replan.ts             | running → worker_request、integrating → integration_replan_requested（candidate 保持）                                                                                            |
| abandon_assignment         | operations/abandon-assignment.ts         | fence 完全一致。実行段階は worker_terminated、統合段階は §7 の照合決定則（publish 済み→ done / clean→ awaiting / 不确定→ fail-closed）                                            |

## 変更ファイル一覧

### 変更

- `tools/ramune/graph/src/graph.ts` — GraphV2 / GraphSession 型、createGraph、findNode
- `tools/ramune/graph/src/graph-schema.ts` — parseGraph（strict スキーマ、version 2 固定）
- `tools/ramune/graph/src/index.ts` — 公開面の全面張り替え
- `tools/ramune/graph/src/invariants.ts` — §2.8 の検査へ全面改訂
- `tools/ramune/graph/src/invariant-violation.ts` — 違反型の拡張
- `tools/ramune/graph/src/cycle-detection.ts` — ノード型を構造化型へ一般化（挙動変更なし）
- `tools/ramune/graph/src/apply.ts` — 構造操作 3 種の操作列適用に縮小
- `tools/ramune/graph/src/persisted-graph.ts` — `session.state` 読み替え
- `tools/ramune/graph/src/operations/{insert-node,reopen,abort,start-session,end-session}.ts`

### 新規

- `src/brand.ts`（Brand・スカラー型とスキーマ）/ `src/nodes.ts` / `src/assignment.ts` / `src/integration.ts` / `src/work.ts` / `src/blockage.ts` / `src/narrowing.ts`
- `src/transaction.ts`（finalizeTransaction / allocateId / overflow エラー）
- `src/ready.ts`（selectReadyNodes）
- `src/operations/task-node.ts`（task ノード探索の共有ヘルパ）
- `src/operations/integration-chain.ts`(解消 chain の閉包)
- `src/operations/{claim-ready,record-result,submit-candidate,claim-integration,advance-integration,record-integration-outcome,request-replan,abandon-assignment,resume-session}.ts`

### 削除

- `src/next-node.ts`、`src/operations/block.ts`、`src/operations/set-result.ts`、`src/operations/operable-node.ts`
- v1 テスト一式（`.feature` / `.spec.ts` / `apply-property.test.ts` / `operations-preconditions.test.ts` 等）

## テスト仕様・検証結果

検証コマンド:

```bash
pnpm --filter @webapp-blueprint/ramune-graph test
```

検証項目とテスト対応:

- `test/graph.test.ts` — createGraph の v2 構造検証
- `test/persisted-graph.test.ts` — parseGraph（roundtrip・strict 拒否・version ゲート）と readSessionActive（state 読み取り）
- `test/invariants.test.ts` — §2.8 の不変条件違反検出（網羅検証）
- `test/ready.test.ts` — 宣言順・limit・依存ゲート・boundary 除外
- `test/structural-operations.test.ts` — insert_node / reopen / abort / applyOperations
- `test/session.test.ts` — start / end（boundary の機械遷移を含む）
- `test/worker-operations.test.ts` — claim_ready / record_result / submit_candidate（fence 拒否を含む）
- `test/integration-flow.test.ts` — claim_integration / advance_integration（段階順序・証跡整合・stale fence）
- `test/integration-outcome.test.ts` — success / conflict 機械挿入 / 解消 chain 同時 done / 失敗 blockage
- `test/recovery-operations.test.ts` — request_replan / abandon 照合（3 分岐）/ resume（epoch +1、旧 fence 失効）
- `test/test-support.ts` — フィクスチャビルダー

テストは公開操作の連鎖で状態を構築することを原則とする。中間状態のみ test-support.ts のビルダーで組み立てる。

## 設計正本からの逸脱・解釈（理由付き）

1. **commit の子孫検査（§2.8-6 の後半）はグラフ層で実装しない**。「Candidate.source は submit 時の current assignment と完全一致」は `source.nodeId === ノード自身 id` として機械検査したが、「commit が baseCommit の子孫」は Git 観測が前提であり、domain 層（zod のみ依存）では検査できない。submit 受付時のサーバ側検査（WP3 / WP6）の責務とする。
2. **reopen の直接対象は blocked のみ**。blocked を reopen した際の、done の後続ノードを従来どおり pending へ連動復帰させるカスケードは維持している（§2.6 が reopen を「blocked → pending」の文脈＝ADR 0007 の resolution 必須化でしか語らず、ResolutionRecord.previous が BlockedSnapshot である以上、done からの直接 reopen はスナップショットを書けないため。done 単体のやり直しは insert_node / abort で構造的に表現する）。
3. **boundary の完了タイミングを補った**（設計が「機械操作だけが遷移させる」としか規定しないため）。start_session が start を done にする（BoundaryResult.runId で開始 run を記録）。end_session は end の deps が全て done の場合のみ end を done にし、未完了なら pending のまま非稼働化する（嘘の証跡を書かない優先）。2 回目の ramune_start で過去の start 証跡を壊さない。
4. **resume は integrating ノードが存在するとき、型付きエラーで拒否する**（`ResumeSessionPreconditionViolation` の `integrating_node_exists`。§7 / §8 の更新どおり）。candidate と journal を保持したまま abandon_assignment の照合で状態を確定させる手順があり、resume が journal を落とすと照合の機会を破壊するため。running ノードのみ blocked(session_resumed) へ遷移し、awaiting_integration は触らない。
5. **aborted variant は payload を一切持たない**（§2.7 の union に aborted の定義がないため、result / candidate / journal / blockage を落とす）。resolutions 履歴は追記専用のため保持する。
6. **claim_ready の workspaces プール契約**。§8 は「fence の配列を返す」だけなので、隔離 worktree（§6.1）をどう受け取るかを次のように決めた: プールを宣言順に消費し、worktree 必要ノードで尽きたら連続 prefix で打ち切り、余りは `workspace_surplus` で拒否（黙って捨てない）。
7. **success 時の完了証跡の WorkReport 部分（summary / data）は candidate.report を流用する**。Worker の作業報告をそのまま完了証跡へ引き継ぐ（新規入力を増やさない）。
8. **advance_integration に追加の整合検査**。publish_prepared への前進時に `integratedCommit` が merge_prepared と一致すること、`verification.checkedCommit === integratedCommit` であることを要求（別 commit を検証した証跡で先へ進めない。fail-fast の帰結）。
9. **abandon_assignment は余計な observedGit を拒否する**（実行段階での提示等。黙って捨てない）。
10. **blockage 等の時刻 stamp は「transaction 確定後の revision」**（occurredAtRevision / detectedAtRevision / reopenedAtRevision = 加算後の値）に統一。
11. **epoch の初期値は 0**（設計未規定。`INITIAL_EPOCH` として export）。
12. **v1 の到達可能性不変条件（unreachable_from_start / cannot_reach_end）は削除**。§2.8 の一覧に存在しないため（互換のために残さない。絶対規約 3）。
13. **UnsupportedGraphVersionError は導入しなかった**。WP2（store）の契約であり、graph 層では parseGraph が version !== 2 を ZodError で拒否する位置づけ。store 側でこのエラー型を定義する。

## 不変条件・スキーマ仕様補足

| #   | 項目                                                 | 仕様・対応                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `taskDepsSchema` が `deps: ["start"]` を受理する仕様 | `taskDepsSchema` を `TaskNodeId \| "start"` の union 配列に設定。roundtrip テストで「`deps: ["start"]` の read_only / repository_change ノードを含む通常グラフ」を検証（persisted-graph.test.ts で parseGraph(JSON.stringify(graph)) が同値）                |
| 2   | `AssignmentFence.nodeId` のブランド化（§2.2）        | `nodeId: TaskNodeId` にブランド化（スキーマは `taskIdSchema`）。各 assignment 型に適用                                                                                                                                                                       |
| 3   | resume_session における integrating ノードの保護     | 設計正本 §7・§8 に合わせ、integrating が 1 件でも存在すれば `ResumeSessionPreconditionViolation`（`integrating_node_exists` + nodeIds）で拒否。テストで「integrating あり → 拒否（グラフ不変）」「abandon 照合で awaiting へ戻した後の resume → 成功」を検証 |
| 4   | reopen 仕様                                          | reopen の直接対象は blocked のみ。blocked を reopen した際の done 後続ノードのカスケード復帰は維持                                                                                                                                                           |

## パッケージ間依存・連携仕様

- mcp-server / viewer は graph v2 スキーマ型を参照する
- hooks は `readSessionActive` の関数シグネチャ（`boolean | undefined` 返却）を参照し、`session.state` 読み取りにより稼働判定を行う
