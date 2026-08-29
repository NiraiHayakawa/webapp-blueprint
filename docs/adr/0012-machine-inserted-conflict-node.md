# 0012. integration conflict は機械が conflict 解消ノードを挿入する

- 状態: 承認済み
- 決定日: 2026-08-24

## 文脈

ADR 0011 の直列統合で merge conflict が起きたとき、誰がどうやって解消の仕事をグラフに載せるかを決める必要がある。
グラフの構造変更は Planner 専用（ADR 0001）だが、並列実行の設計では実行中ノードがある間 Planner の構造変更を拒否する（設計正本 §5）ため、Planner に解消を委ねると統合のたびに実行を止めて Planner のラウンドトリップを待つことになる。

## 決定

conflict の検知を受けた MCP サーバが、単一トランザクションで conflict 解消ノードを機械的に挿入する。

- 衝突したノード C は `blocked(integration_conflict)` に着地し、candidate を保持する
- サーバは解消ノード R（`purpose: conflict_resolution`、`resolves: C.id`、衝突情報を専用フィールドで記録。ID は永続 allocator から発番する）を C の deps と C の間に挿入する。R は即 ready になり、通常の Worker が claim して解消する
- **R は通常の repository_change ノードとして扱い、candidate 提出 → 直列統合（ADR 0011）の経路をそのまま通す**。R の統合成功のトランザクションが、R と C（再 conflict で解消 chain が伸びていた場合はその全体）を同時に done にする

設計の正本は [docs/plan/Ramune/20260824_parallel-execution.md](../plan/Ramune/20260824_parallel-execution.md)（§6.3）。

## 理由と捨てた代替案

conflict の解消は「candidate と canonical の両方の変更を成立させる」という定型の仕事であり、必要な入力（candidate commit、canonical の HEAD、衝突ファイル一覧）は機械が全部持っている。
ノードの生成に Planner の判断は要らず、機械挿入なら他のノードの実行を止めずに解消が進む。

- 代替案 A（`blocked` に着地させ、Planner が resolution 付きで reopen する）: 解消方針に Planner の判断が入る分だけ質は上がりうるが、統合のたびに Planner のラウンドトリップが入り、並列実行の利得を削る。解消が定型を超える（衝突が設計の矛盾を示している）場合は、R の Worker が `ramune_request_replan` で Planner に差し戻せるため、判断が要るケースの経路は失われない
- 代替案 B（機械が reopen して同じノードを再実行する）: 解消という仕事がグラフ上のノードとして観測できない。何が起きたかをグラフの形で残す（絶対規約 12）には、ノードが生える方が正しい
- 代替案 D（R の Worker が統合済み commit を直接作り、専用ツールで R と C を done にする。本 ADR の初案）: R の Worker が canonical を書くことになり、ADR 0011 の「canonical への書き込みは単一経路の CAS のみ」と矛盾する。Worker が隔離 worktree に留まるなら canonical 未反映のまま done になり、どちらに倒しても壊れる。敵対的レビューで棄却した
- 代替案 C（自動 merge のリトライや戦略切り替え）: 解消の失敗を機械が隠す方向であり、絶対規約 2 に反する

機械挿入は「実行中は Planner の構造変更を拒否する」規則と矛盾しない。
挿入は決定的なサーバ内部操作であり、挿入位置の後続は C の done を待つ pending だけなので、実行中ノードの依存関係を変えないからである。

## 影響

- 本 ADR は設計の採用であり、実装はこれから行う。実装 PR は `ramune_record_integration_outcome` の conflict 経路（機械挿入と解消 chain の同時 done）、`purpose: conflict_resolution` / `resolves` のスキーマ、[docs/recipes/tools/ramune.md](../recipes/tools/ramune.md) の更新を同梱する
- グラフの構造変更の主体が「Planner のみ」から「Planner と、この 1 操作に限るサーバ内部」へ広がる。hook の権限表は変わらない（サーバ内部操作は MCP ツール呼び出しではないため）
