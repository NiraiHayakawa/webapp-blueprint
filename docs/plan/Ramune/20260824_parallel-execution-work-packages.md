# ramune 並列実行の実装指示書（work packages）

設計の正本は [20260824_parallel-execution.md](20260824_parallel-execution.md)。
本書は並列実行の実装単位（work package）を定義した指示書であり、設計判断を含まない。
設計と矛盾したらこの文書ではなく設計正本を正とする。

## 全 WP 共通の指示

作業着手前に該当 WP 節と設計正本を確認する。

- 最初に `AGENTS.md` の絶対規約と設計正本の全文を読む
- TDD で進める。テスト対象は公開契約のみ（型、zod スキーマ、operations の入出力、MCP クライアント経由のツール呼び出し、hook の stdin / stdout 契約）。private 関数、内部状態、呼び出し順を固定するテストを書かない
- v1 との互換コード（alias、旧フィールドの受理、runtime migration）を一切書かない。v1 の痕跡は削除する
- silent fallback、デフォルト値による補完、自動リトライを書かない。前提が崩れたら型付きエラーを投げる
- 各パッケージの vitest と `mise run check` を実行し、受入基準を満たすことを確認する
- 受入結果は `docs/plan/Ramune/acceptance/<WP名>.md` に、変更ファイル一覧、実行したテストと結果、設計正本からの逸脱（あれば理由）を記録する

## WP1: graph v2（依存なし。最初に着手）

対象: `tools/ramune/graph/`

- 設計正本 §2 の v2 スキーマを実装する。**branded type を全面採用**し（`Brand<T, Name>`、zod v4 の `.brand<>()` で実行時契約と対応させる）、全 object / union branch を strict にして未知キーをエラーにする
- ノードは boundary（start / end）と task（read_only / repository_change）の discriminated union。status ごとの必須 / 禁止フィールドは §2.1〜§2.7 の型のとおり
- `nextAllocationId`（永続 allocator）を導入し、assignmentId / conflictId / blockageId / 機械生成ノード ID をここから発番する。`attempt` フィールドは作らない
- operations を追加・置換する: `claim_ready`（fence 発番込み）、`submit_candidate`（source はサーバコピー）、`claim_integration`（journal 生成込み）、`advance_integration`、`record_integration_outcome`（success の解消 chain 同時 done / conflict の機械挿入 / 各失敗 blockage への遷移をすべて含む）、`abandon_assignment`（fence 完全一致 + §7 の照合決定則）、`resume_session`。`set-result` は read_only の完了に限定する
- `reopen` は resolution 必須で `resolutions` へ 1 件追記（`ResolutionRecord`）。`integration_conflict` / `integration_state_uncertain` の reopen 禁止、`verification_failed` の canonical clean 前提条件を実装する。done カスケードの挙動は維持する
- invariant は §2.8 の一覧をすべて実装する
- `selectNextNode`（`next-node.ts`）を削除し、宣言順で ready を最大 N 件選ぶ純関数に置き換える（遷移は operations 側の責務）
- `persisted-graph.ts`（hook が読む `session.active` 相当の 1 ビット）は v2 の `session.state` を読む形に更新する。node_modules 非依存の性質は維持する（ADR 0004）
- v1 前提のテストを削除し、新契約のテストを書く

## WP2: GraphStore transaction（WP1 の後）

対象: `tools/ramune/mcp-server/src/store.ts`

- `load` / `save` の分離公開をやめ、`transaction(fn)` に全書き込みを集約する（§4）。**async mutex で明示的に直列化する**（HTTP transport ではリクエストが並行に届く前提で書く）
- 永続化は同一ディレクトリの一時ファイルへ書き、`fsync → rename → 親ディレクトリ fsync` の atomic replace にする
- 判断系のための `expected_revision` 検査を transaction の入口で提供する。mismatch は型付きエラー。自動リトライを書かない
- `version !== 2` は変更前に `UnsupportedGraphVersionError` で拒否する。v1 ファイルの退避は「内容を parse せず raw で別名保存」する明示操作として提供する
- クロスプロセスのファイルロックは書かない（二重起動の防止は WP5 の port bind が担う）

## WP3: MCP ツール契約（WP1、WP2 の後。ツール単位で内部並列可）

対象: `tools/ramune/mcp-server/src/tools/`、`server.ts`

- 設計正本 §8 の表のとおりにツールを実装・置換する。`next-node.ts` は削除する
- `ramune_apply_ops` から `set_result` を外し、実行中ノード（`running` / `awaiting_integration` / `integrating`）が 1 件でもあれば拒否する
- 完了系は fence の完全一致で認証し、判断系は `expected_revision` を要求する（§4 の粒度分け）
- `ramune_record_integration_outcome` は outcome の discriminated union（success / conflict / verification_failed / candidate_rejected / integration_state_uncertain）を 1 ツールで受ける
- JSON Schema（ajv 検証）を新契約に合わせて書き直す。旧スキーマの受理を残さない
- テストは MCP クライアント経由で行い、二重 claim 不成立、stale fence 拒否、conflict でのノード機械挿入と解消 chain の同時 done を含める

## WP4: hooks（WP1 のツール名一覧のみに依存。WP1 と並列可）

対象: `tools/ramune/hooks/src/`

- `role.ts` に `integrator` を追加する（`agent_type: "integrator"`）
- `policy.ts` の権限表を設計正本 §8 のロール列に置き換える。`ramune_next_node` の行は削除する
- graph locator の解決を実装する: どの worktree の cwd から呼ばれても canonical graph を解決し、解決できなければ fail-closed で拒否する（§9）
- fail-closed の方針（判定不能は拒否）と `mode.ts` の稼働判定の枠組みは変えない（`session.state` の読み替えのみ）
- テストは stdin / stdout 契約で書く

## WP5: SDK v2 + Streamable HTTP（WP3 の後）

対象: `tools/ramune/mcp-server/`、`.mcp.json`、`mise.toml`

- `@modelcontextprotocol/sdk` v1 から SDK v2（spec 2026-07-28、パッケージ分割: `@modelcontextprotocol/server` 等）へ移行する。**着手前に採用バージョンの公開日が 7 日以上前であることを確認し、成果物ファイルに記録する**（`docs/principles/pin-dependencies.md`）
- transport を stdio から Streamable HTTP に変える。port は設定で固定し、**bind 失敗は型付きエラーで即死させる**（二重起動の排他。ADR 0013）。起動時に graph 配置パスの所有を検査する
- `mise.toml` に `mcp:ramune:serve`（`depends = ["install"]`）を追加し、旧 `mcp:ramune`（stdio 起動）を削除する
- `.mcp.json` の ramune エントリを `type: "http"` に置き換える（blume-docs エントリが形の前例）
- サーバ不在時に自動 spawn する fallback を書かない

## WP6: worktree と統合の Git 機構（WP1 の後。WP2 / WP3 と並列可）

対象: `tools/ramune/` 配下の新パッケージ（graph / mcp-server から独立したモジュール）。WP1 の型（`IntegrationJournal` / `GitObservation` / `CommitId` 等）だけに依存し、MCP ツールへの配線は WP3 / WP5 側が行う

- claim 時の隔離 worktree の割当（`workspaceId` 発番、`git worktree add`）と、done / abort 後の回収
- Integrator 用の統合 worktree での merge、`mise run check` の実行と `SuccessfulCheck` / `FailedCheck` 証跡の生成
- canonical publish: journal `publish_prepared`・fence 一致・expected HEAD（`canonicalHeadBefore`）の 3 条件を検査してから fast-forward する単一経路（§6.4）。条件が崩れていたら publish せず `integration_state_uncertain` に落とす
- 失敗経路の cleanup（merge 中断、index / `MERGE_HEAD` / worktree の復元）と、`integration_conflict` の `canonicalAfterCleanup` 証跡の生成
- `GitObservation` の採取（abandon 照合の入力。§7）

## WP7: agents 定義と現行規範（WP3〜WP6 の後）

対象: `.claude/agents/`、`.claude/settings.json`、`docs/recipes/tools/ramune.md`、`AGENTS.md`

- `.claude/settings.json` の PreToolUse matcher（旧ツール名の明示列挙）を設計正本 §8 のツール一覧に置き換える。ここが古いままだと新ツールに hook が発火せず、権限表が機械強制されない（WP4 の独立レビューで検出済みの穴）

- `.claude/agents/integrator.md` を新設する（frontmatter `name: integrator`、model sonnet、tools は Read / Grep / Glob / Bash と統合系 ramune ツール）。worker.md / planner.md を新契約に合わせて書き直す
- `docs/recipes/tools/ramune.md` と `AGENTS.md`「ramune モード」表を、役割 3 + Orchestrator と HTTP サーバ起動手順（`mise run mcp:ramune:serve`）に合わせて更新する。手順の複製を作らず、設計正本と ADR 0010〜0013 へのリンクで済ませる
- ADR 0010〜0013 の状態を「提案中」から「承認済み」へ更新する（索引表も）
- `mise run sync:agents` を実行して `.agents/skills/` の複製を揃える

## WP8: 並列シナリオの公開契約テスト（WP3〜WP6 の後）

対象: `tools/ramune/mcp-server/test/`、必要なら `e2e/`

設計正本 §12 に従い、次のシナリオを MCP クライアント経由で検証する。

- 同一グラフへの連続 claim が同じノードを返さない（claim の原子性）
- stale fence（assignmentId 不一致・旧 epoch・旧 runId）の完了報告が型付きエラーで拒否される
- 独立な 2 Worker の完了報告が両方保存される（lost update なし）
- `integrating` が高々 1 件の invariant と、publish の 3 条件検査
- integration conflict で C が blocked になり R が機械挿入される。R の統合成功で R と C（chain）が同時に done になる
- abandon 照合の決定則（publish 済み → done、未着手 clean → awaiting_integration、確定不能 → integration_state_uncertain）
- `ramune_resume` が旧 assignment を `blocked(session_resumed)` にし、以後の旧 epoch 書き込みを拒否する
- 実行中ノードがある間の `ramune_apply_ops` / `ramune_end` が拒否される
- HTTP サーバの二重起動が bind 失敗で落ちる（WP5 の契約）
