# 0011. 書き込みノードは隔離 worktree で candidate を作り、直列の統合工程を経て done になる

- 状態: 承認済み
- 決定日: 2026-08-24

## 文脈

Worker を並列にすると、DAG 上で独立な 2 ノードでも同じファイル（lockfile、フォーマッタの出力、Git index）を触りうる。
DAG の独立性は変更ファイルの独立性を保証しないため、ファイル編集競合の扱いを決める必要がある。

## 決定

「作業は並列、統合は直列」とする。

- リポジトリを変更するノード（`effect: repository_change`）の Worker は、割り当てられた隔離 git worktree でだけ編集し、candidate commit を提出する（`running → awaiting_integration`）。提出時点では done にならない
- 専用ロール Integrator が candidate を**自分の統合用 worktree** で 1 件ずつ merge し、1 コマンド検証（`mise run check`）の成功をもって canonical へ publish して `done` にする
- 統合の進行段階（claimed / merge_prepared / publish_prepared）は journal としてグラフに永続化し、canonical への publish は fence と expected HEAD を検証する単一経路の CAS だけが行う（merge と graph 更新は原子的にできないため、crash 後に照合可能な形で分割する）
- canonical への書き込み主体は常に 1 本（`integrating` は graph 全体で高々 1 件）であることを invariant として機械強制する。失敗経路では canonical と統合用 worktree を clean に戻してから記録する
- 読み取りだけのノード（`effect: read_only`）は worktree を割り当てず、`running → done` に直行する
- 隔離の前提（全 worktree が同一 MCP サーバと canonical graph を参照する、hook が locator 欠落を fail-closed で拒否する等）を実測するまで、`repository_change` の並列度は 1 に留める

設計の正本は [docs/plan/Ramune/20260824_parallel-execution.md](../plan/Ramune/20260824_parallel-execution.md)（§6、§9）。

## 理由と捨てた代替案

merge と検証の成功を done の条件に組み込むことで、「並列に作った変更が実は両立しない」という失敗が、後続ノードの実行前にグラフ上で観測可能になる（絶対規約 12）。

- 代替案 A（同一 worktree でファイル範囲を申し合わせて並列編集する）: Planner がノードを触るファイルで分割しても、lockfile、フォーマッタ、Git index、`Bash` 経由の書き込み（ADR 0006 で機械強制の対象外）を防げない。申し合わせは散文の規約であり、機械で縛れない（絶対規約 4）
- 代替案 B（worktree ごとにグラフを複製する）: SSoT が複数になり、ADR 0001 に反する
- 代替案 C（統合も並列にする）: canonical への並行 merge は Git レベルの競合と検証結果の混線を生む。統合は 1 件ずつでも、作業時間の大半を占める Worker の実行が並列であれば律速にならない

## 影響

- 本 ADR は設計の採用であり、実装はこれから行う。実装 PR は次を同梱する: worktree の割当と回収の機構、`.claude/agents/integrator.md` の新設、`tools/ramune/hooks`（`integrator` role と権限表）、[docs/recipes/tools/ramune.md](../recipes/tools/ramune.md)、`AGENTS.md`「ramune モード」節
- 統合が conflict した場合の扱いは ADR 0012 が決める
- 「Worker が canonical worktree を直接書かない」ことの機械強制（cwd 検査 / sandbox)は未決であり、write 並列解禁前の hard gate として設計正本 §9 に置いた
