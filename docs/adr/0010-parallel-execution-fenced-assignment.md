# 0010. Worker の並列実行は、グラフに外在化した fenced assignment で排他する

- 状態: 承認済み
- 決定日: 2026-08-24

## 文脈

ramune の実行モデルは「Orchestrator が Planner と Worker を交互に逐次起動する」前提で作られており、`ramune_next_node` は副作用のない読み取りである。
複数 Worker を並列に走らせたい要求に対し、並列に呼ばれた `ramune_next_node` は同じノードを返し、`GraphStore` の read-modify-write には並行制御がない。
排他をどこに置くかを決める必要がある。

## 決定

排他はグラフに外在化する。

- ノード選択と `pending → running` 遷移を同一トランザクションで行う `ramune_claim_ready` を導入し、`ramune_next_node` は削除する（互換 alias を残さない）
- claim はノードに fence（`{ nodeId, runId, epoch, assignmentId }`）を書き込み、以後の完了系書き込みはその**完全一致**を要求する（fenced assignment）。`assignmentId` はグラフ内の永続 allocator から発番し再利用しない。時間 lease と自動再割当は持たない
- 「単一 MCP サーバプロセスが唯一の writer」を契約とし、全書き込みを `GraphStore.transaction`（in-process 直列化 + revision + atomic replace）に集約する。判断系ツールは `expected_revision` を要求し、mismatch は型付きエラーとして呼び出し側に再判断させる
- グラフは破壊的に `version: 2` とし、v1 parser と runtime migration は作らない

設計の正本は [docs/plan/Ramune/20260824_parallel-execution.md](../plan/Ramune/20260824_parallel-execution.md)（§2 から §5、§7）。

## 理由と捨てた代替案

グラフを唯一の真実源とする ADR 0001 の決定に従えば、割当という状態も会話文脈ではなくグラフに置くのが一貫する。
また assignment がグラフにあれば、セッション断の後でも「どのノードが実行中だったか」を観測できる。

- 代替案 A（Orchestrator の会話文脈で割当を管理する）: グラフのスキーマは無変更で済むが、割当状態が会話文脈という揮発領域に戻り、SSoT の決定（ADR 0001）と ADR 0003 の経緯（揮発性の高い場所に状態を置く判断の破綻）に反する
- 代替案 B（ready 集合を返す読み取り API + 後続の claim）: 読みと書きの間に TOCTOU が残り、排他の問題を解決しない
- 代替案 C（時間 lease と自動再割当）: lease が失効しても旧 Worker のファイル編集能力は失効しない。自動再割当は同一ノードの二重編集を静かに許すため、失敗の隠蔽（絶対規約 2）に当たる。回復は明示操作（`ramune_abandon_assignment` / `ramune_resume`）だけで行う
- 代替案 D（revision 競合時の自動リトライ）: 判断系の競合は「前提が変わった」ことを意味し、機械的な再適用は semantic conflict を隠す。型付きエラーで agent に再判断させる
- 代替案 E（クロスプロセスのファイルロック）: writer を単一プロセスに限定できるなら in-process 直列化で足りる。「単一プロセスである」こと自体の保証は ADR 0013（単一共有 HTTP サーバと port bind による排他）が担う

## 影響

- 本 ADR は設計の採用であり、実装はこれから行う。実装 PR は次の更新を同梱する: `tools/ramune/graph`（v2 スキーマと operations）、`tools/ramune/mcp-server`（transaction とツール置き換え）、[docs/recipes/tools/ramune.md](../recipes/tools/ramune.md)、`AGENTS.md`「ramune モード」節
- `ramune_next_node` を前提とするテストと agents 定義（planner.md / worker.md）は実装 PR で書き換える
- ADR 0011（隔離 worktree と直列統合）、ADR 0012（conflict 解消ノードの機械挿入）が本決定の上に載る
