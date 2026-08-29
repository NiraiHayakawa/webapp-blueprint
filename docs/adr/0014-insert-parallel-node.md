# 0014. Planner の構造操作に並列分岐（insert_parallel_node）を追加する

- 状態: 承認済み
- 決定日: 2026-08-25

## 文脈

実地検証（[docs/plan/Ramune/acceptance/live-verification.md](../plan/Ramune/acceptance/live-verification.md)）で、`insert_node` が「1 本の edge を from → new → to に裂く」splice 専用であることに起因するギャップが見つかった。
素の start → end 骨格に対して splice を 1 回行うと edge start → end が消えるため、2 回目の挿入が `edge_not_found` で必ず拒否され、**Planner が独立な並列ノードの初期計画を立てられない**。
並列実行（ADR 0010〜0013)を導入した以上、fan-out を正規の Planner 操作で表現できる必要がある。

## 決定

構造操作 `insert_parallel_node { from, to, newNode }` を追加する（Planner 専用。`ramune_apply_ops` の操作列）。

- 効果: `newNode.deps = [from]` とし、`to.deps` に `newNode.id` を**追記**する（既存の deps は変更しない）
- splice と異なり edge from → to の実在を要求しない。これにより骨格からの 2 本目以降の分岐が可能になる
- newNode は from を親、to を子に持つため、ADR 0001 の「孤立ノードが構造的に発生しない」性質は維持される。サイクルは適用後の invariant 検査が拒否する

## 理由と捨てた代替案

- 代替案 A（`insert_node` に mode フラグを足す）: 1 操作に 2 つの意味を持たせるフラグは契約を曖昧にする。splice と branch は前提条件もエラー集合も異なるため、別操作として分けた
- 代替案 B（グラフの直接編集を許す）: 実地検証で回避策として使ったが、トランザクション・invariant 検査・権限強制の外側であり正規経路にできない
- 代替案 C（初期計画だけ特別な一括構築操作を作る）: 初期と追加で操作が分かれると Planner の判断が増える。fan-out は初期に限らず必要（レビュー後のノード追加でも起きる）

## 影響

- `tools/ramune/graph`（操作・invariant テスト）、`tools/ramune/mcp-server`（apply_ops スキーマ）、`.claude/agents/planner.md`、設計正本 §8 を同一 PR で更新する
- hook の権限表は変わらない（`ramune_apply_ops` の内側の操作であるため）
