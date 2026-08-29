# レシピ: ramune(検証付きタスクグラフ実行機構)

原則: [`docs/principles/fail-fast.md`](../../principles/fail-fast.md)(silent fallback を作らない)・[`docs/principles/docs-two-layer.md`](../../principles/docs-two-layer.md)(決定ログと現行規範の二層)・[`docs/principles/enforce-with-machines.md`](../../principles/enforce-with-machines.md)(規約は機械で縛る)

決定ログ: [ADR 0001(ramune のアーキテクチャ)](../../adr/0001-ramune-architecture.md)・[ADR 0002(Worker から Planner への差し戻し経路)](../../adr/0002-worker-replan-signal.md)・[ADR 0003(ramune モードの状態機構)](../../adr/0003-ramune-mode-session-field.md)・[ADR 0004(起動経路が依存インストールを自分で保証する)](../../adr/0004-harness-bootstrap.md)・[ADR 0008(advisor サブエージェント)](../../adr/0008-advisor-by-subagent.md)。並列実行の設計とその決定は正本 [docs/plan/Ramune/20260824_parallel-execution.md](../../plan/Ramune/20260824_parallel-execution.md) と [ADR 0010(fenced assignment)](../../adr/0010-parallel-execution-fenced-assignment.md)・[ADR 0011(隔離 worktree と直列統合)](../../adr/0011-isolated-worktree-serial-integration.md)・[ADR 0012(conflict 解消ノードの機械挿入)](../../adr/0012-machine-inserted-conflict-node.md)・[ADR 0013(単一共有 HTTP サーバ)](../../adr/0013-mcp-v2-shared-http-server.md)。このファイルは ADR の要約ではなく「何をするか / いつ要るか / どう使うか」の手引きであり、決定の理由と却下した代替案は ADR 側が正本。

## 何をするか / いつ要るか / テンプレの採否

| 項目           | 内容                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 何をするか     | Claude Code の上に載る、検証付きタスクグラフ実行機構。会話の文脈にタスクの状態を置く代わりに `.ramune/graph.json`(v2)を DAG として唯一の真実源にする。Orchestrator(駆動役)の下で Planner(計画・グラフ編集)/ Worker(実行・`Edit`/`Write`)/ Integrator(統合工程)の権限を hook で構造的に分離し、複数 Worker の並列実行を隔離 worktree と直列統合で安全にする(プロンプト上の取り決めではなく機械強制) |
| テンプレの採否 | **既定で組み込み**(`tools/ramune/` 配下)。blume MCP・codegraph MCP と同じく「テンプレートが最初から持つ AI ネイティブなハーネス」の一部という位置づけであり、`contract/` のような空スロット(プロジェクト開始後に選ぶもの)ではない                                                                                                                                                                  |

## monorepo 配置

ramune は `apps/`(削除して始めてよい最小の縦切り)ではなく `tools/`(`tools/architecture/` と同じ階層)に置く。ハーネスは縦切りと性質が違い、削除されては困るため。

| 場所                      | 内容                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/ramune/graph`      | グラフ v2(DAG モデル・branded 型・zod スキーマ・不変条件検査・fenced assignment / operations / invariant)。`.ramune/graph.json` の配置パス規約もここ |
| `tools/ramune/mcp-server` | 設計正本 §8 の 13 ツールの MCP 実装(一覧は正本を参照)                                                                                                |
| `tools/ramune/hooks`      | Orchestrator / Planner / Worker / Integrator のツール権限を fail-closed で機械強制する PreToolUse hook(canonical graph locator 含む)                 |
| `tools/ramune/git`        | 隔離 worktree の割当と回収・統合 merge・1 コマンド検証の証跡・canonical publish の CAS・GitObservation 採取(§6 / §7 の Git 機構ライブラリ)           |
| `tools/ramune/viewer`     | `.ramune/graph.json` を読み取り専用で表示するビューア                                                                                                |

hook が機械強制するのは `Edit` / `Write` と ramune の MCP ツールである。`Read` / `Grep` / `Glob` はどのロールも制限されない([ADR 0005](../../adr/0005-ramune-restricts-mutation-not-observation.md))。`Bash` は対象外([ADR 0006](../../adr/0006-bash-outside-ramune-enforcement.md)) — 「変更できるのは Worker だけ」は規範としては維持するが、機械強制は `Edit` / `Write` の経路に限る。

PreToolUse hook の stdin の実測仕様(公式ドキュメントに明記されていない挙動)は [`docs/recipes/pre-tool-use-hook-input.md`](../pre-tool-use-hook-input.md) を参照。

## ロール: Orchestrator とサブエージェント 3 役

グラフへの書き込みはすべて MCP ツール経由で行われる。ロールは 4 つ:

| ロール       | 誰か                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Orchestrator | メインエージェント(駆動主体)。セッション出入り・claim・回復を担い、構造変更・結果記録・直接編集はしない |
| Planner      | `.claude/agents/planner.md`。グラフの構造だけを編集する                                                 |
| Worker       | `.claude/agents/worker.md`(並列 dispatch される)。ノードを実行し candidate を提出する                   |
| Integrator   | `.claude/agents/integrator.md`(直列)。統合工程を担う                                                    |

どのロールがどのツールを呼べるかは hook が機械強制する。**権限表の正本は `tools/ramune/hooks/src/policy.ts`(設計正本 §8 の表)**であり、ここには複製しない。実行モデルの詳細(claim の fence・candidate の提出・統合 journal・conflict 解消ノード R の機械挿入・abandon 照合)は設計正本 §3〜§7 と各 agent 定義を参照。

## 新しい worktree で何が要るか(何も要らない)

`node_modules/` は worktree ごとに空から始まるが、**ramune を使う前に手で `pnpm install` する必要は無い**([ADR 0004](../../adr/0004-harness-bootstrap.md))。

| 経路                                                  | 依存の扱い                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP サーバ(`.mcp.json` → `mise run mcp:ramune:serve`) | task が `depends = ["install"]` で自分の前提を満たす。サーバは単一共有の Streamable HTTP サーバとして port bind を排他ロックに使う([ADR 0013](../../adr/0013-mcp-v2-shared-http-server.md)。二重起動は bind 失敗で loudly に落ちる) |
| PreToolUse hook                                       | `node_modules` の解決を必要とする import を持たないため、install の前でも動く。役割強制が fail-open に落ちない                                                                                                                      |
| `mise run check` 等の通常タスク                       | 対象外。依存が無ければ loud に失敗する(silent に緑にならないため、この保証の対象に含めていない)                                                                                                                                     |

つまり **clone / worktree 作成の直後にセッションを開いてよい**。`mise run ramune:status` が「ramune: 非稼働」と答えれば、依存も MCP サーバも正常である。逆に `mcp__ramune__*` ツールが見つからない場合は、依存ではなく MCP サーバ側の別の失敗を疑う(`mise run mcp:ramune:serve` を手で起動して stderr を読む)。サーバ不在時の自動 spawn fallback は存在しない(§5)。

### Codex CLI と linked worktree の既知の制約

Codex CLIでは、linked worktreeから起動したときにproject-localの`.codex/hooks.json`が読み込まれない場合がある（[upstream issue](https://github.com/openai/codex/issues/27133)）。

該当する場合は、Codexのuser-level hooks設定に`.codex/hooks.json`と同じ`PreToolUse` matcher groupを追加し、checkout内の`tools/ramune/hooks/src/adapters/codex/cli.ts`を呼ぶ。対象checkoutのpathは環境ごとに明示し、既存のuser-level hooksを保持したまま追加する。project-local設定は通常checkout用として残す。

user-level hookは全repositoryで評価されるため、対象checkoutを削除・移動した場合は対応するgroupも明示的に更新または削除する。

## ramune モード: 明示的に入るものであり、既定で全操作を縛るものではない

**ramune の PreToolUse hook は稼働中、ロールごとの権限を fail-closed で機械強制する。** これを無条件で既定有効にすると、本テンプレートを clone しただけの利用者(ramune を使う意思のないエージェント)が最初から何も編集できなくなり、通常の作業が成立しない。そのため ramune の権限強制は「ramune モードに明示的に入っているときだけ」発動する必要がある。

| 状態                                    | hook の挙動                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| **ramune 稼働中**(明示的な条件を満たす) | **fail-closed で役割を強制**する。ロールが判定できない場合は拒否する(安全側に倒す) |
| **ramune 非稼働**                       | **判定を下さない**(何も出力せず exit 0 = 通常の Claude Code の権限フローに委ねる)  |

「非稼働なら判定を下さない」は silent fallback ではない。silent fallback は「本来なら拒否すべき状況を、検出できないまま黙って通す」ことを指すが、ここでは前提となる ramune モードそのものが存在しない。**ロールが定義されていない状況で役割を強制する方が誤りである** — 強制すべき規約が無い場所に規約を持ち込むことになるため。ramune モードの内側に入って初めて、ロールとその権限表(policy.ts。§8 の表)が意味を持つ。

### 「稼働中」の判定条件: canonical graph の `session.state`

判定条件は canonical リポジトリの `.ramune/graph.json` の `session.state`(`tools/ramune/hooks/src/mode.ts` の `isRamuneModeActive`)。エージェントに「ramune に入って」と言えば、Orchestrator が MCP ツール `ramune_start` を呼んで入る。稼働を終えるときは `ramune_end` を呼ぶ(グラフ自体は削除・変更しない)。

hook はセッションの作業ディレクトリから canonical リポジトリを解決する(git 配置ベースの locator。linked worktree の cwd からでも canonical 側の稼働判定が効く。設計正本 §9)。解決できない場合(リポジトリ外・壊れた worktree 配置等)は「非稼働」に丸めず fail-closed で拒否する。

| canonical の `.ramune/graph.json` の状態                                   | 判定                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ファイルが無い                                                             | **非稼働**。ramune をまだ一度も開始していない                                                                                   |
| あり、`session.state` が `"active"`(`runId` / `epoch` を伴う)              | **稼働中**                                                                                                                      |
| あり、`session.state` が `"inactive"`                                      | **非稼働**。`ramune_end` した後、または `ramune_start` していないグラフ                                                         |
| 壊れている(JSON 不正)、`session.state` が読めない、v1 形(`session.active`) | **判定不能**。`RamuneModeIndeterminateError` を投げ、安全側に倒して deny する(「非稼働」に丸めない。旧フィールドの受理はしない) |

hook は呼び出しごとに毎回このファイルを同期的に読む(`ramune_start`/`ramune_end` の効果が次の hook 呼び出しに即座に反映されるため。読み込みコストは許容する)。hook のエントリポイント(`tools/ramune/hooks/src/pre-tool-use.ts` の `runHook`)は、まずこの判定を行い、

- 非稼働なら role/policy 判定に進まず空文字列を返す(`main()` は何も出力せず exit 0。Claude Code の通常の権限フローに委ねる)
- 稼働中なら `runPreToolUseHook`(role 判定 → policy 判定 → fail-closed)にそのまま委譲する
- 判定不能なら role/policy 判定に進まず、理由付きで deny する

`ramune_start` / `ramune_end` / claim / resume / abandon は Orchestrator 専用(サブエージェントは拒否される)。稼働中に `ramune_start` を再度呼ぶ、または非稼働時に `ramune_end` を呼ぶと、MCP ツール側の前提条件違反(`StartSessionPreconditionError` / `EndSessionPreconditionError`)として明確に拒否される。現在の状態は `mise run ramune:status` で確認できる。

#### 経緯: なぜ環境変数 `RAMUNE_MODE` から書き換えたか

当初は環境変数 `RAMUNE_MODE=1` を判定条件にしていた(「セッションをまたいで状態が残らない方が安全」という理由づけ)。この設計は2点で破綻していた: (1) hook は Claude Code 起動時の環境を引き継ぐだけで、エージェントが実行途中で自分自身の環境変数を書き換える手段が無いため、「エージェントに言われたら入る」という要件を満たせない。(2) 環境変数という揮発性の高い場所にモードを置く判断は、ramune 自身の原則1「状態の外在化」(グラフが唯一の真実源であり、セッションが死んでも状態は残る)と矛盾していた。詳細と却下した代替案は [ADR 0003](../../adr/0003-ramune-mode-session-field.md) を参照。同じ検討を繰り返さないための記録である。

## v1 グラフ(v2 以前のファイル)の扱い

並列実行のためグラフスキーマは破壊的に `version: 2` となった(設計正本 §2)。v1 のグラフファイルを受理・移行するコードは存在せず、`version !== 2` の変更操作はすべて `UnsupportedGraphVersionError` で拒否される。エラーメッセージが案内する手順に従い、内容を parse せず raw のまま別名退避する明示操作(`archiveUnsupportedVersion`)を行った上で、`ramune_start` で v2 グラフを作り直すこと。
