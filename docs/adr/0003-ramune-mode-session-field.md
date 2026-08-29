# 0003. ramune モードの状態機構: 環境変数からグラフの session フィールドへ

- 状態: 承認済み
- 決定日: 2026-08-09

## 文脈

ramune モード（Planner/Worker の役割を PreToolUse hook が fail-closed で機械強制する状態）の
稼働/非稼働を判定する機構は、当初 `docs/recipes/tools/ramune.md`「ramune モード」節（2026-08-09
時点の版）と `tools/ramune/hooks/src/mode.ts` の実装として、環境変数 `RAMUNE_MODE` の値
（未設定=非稼働、`"1"`=稼働中、それ以外=判定不能でエラー）を判定条件にしていた。この選択は
ADR として書かれておらず、レシピと実装コメントだけがその理由（「セッションをまたいで状態が
残らない方が安全」）を記していた。

この設計には次の2つの問題があった。

1. **要件を満たせない。** 「エージェントに『ramune に入って』と言ったら入る」ようにしたいが、
   hook は Claude Code が起動時に受け取った環境を継承するだけであり、エージェントが実行途中で
   自分自身のプロセスの環境変数を書き換えることは原理的にできない。`RAMUNE_MODE=1` を稼働中に
   後から設定する手段が無い以上、モードへの出入りは「Orchestrator を起動するシェルで事前に
   環境変数を設定してからセッションを開始する」という、セッション開始前にしか行えない操作に
   固定されてしまっていた。
2. **ramune 自身の原則1（状態の外在化）と矛盾していた。** ADR 0001 の決定は「タスクの状態を
   LLM の会話履歴に置かず、リポジトリ内の `.ramune/graph.json` に DAG として保持する。グラフが
   唯一の真実源であり、コンテキストがリセットされてもプロセスが落ちても状態は残る」ことである。
   環境変数を選んだ理由づけ（「セッションをまたいで状態が残らない方が安全」）は、この主張と
   正面から矛盾する。グラフ（実行の中身）が生き残るのに、モード（実行しているという事実）だけが
   プロセス起動時の環境という揮発性の高い場所に置かれ、セッションが死んだら再開時にモードの外に
   戻ってしまうのは一貫性が無い。実行途中でセッションが死んでも、再開時は依然としてモードの中に
   いるのが正しい。

## 決定

- ramune モードの稼働/非稼働を、`.ramune/graph.json` の中の明示的なフィールド
  `session: { active: boolean }` として持つ（`@webapp-blueprint/ramune-graph` の `Graph` 型）。
  `createGraph()` はグラフ作成時点では常に `session: { active: false }` から始める
  （グラフを作ること自体はモードを稼働状態にする行為ではない）
- グラフに新しい差分操作 `start_session` / `end_session`（`@webapp-blueprint/ramune-graph` の
  `GraphOperation` 判別共用体に追加）を持たせる。前提条件はそれぞれ「現在 `false`
  であること」「現在 `true` であること」で、満たさない場合は `StartSessionPreconditionError` /
  `EndSessionPreconditionError` を投げる。どちらもノード群（`nodes`）には一切触れない
- 新しい MCP ツール `ramune_start`（goal を受け取り、グラフが無ければ作成してから
  `start_session` を適用する）と `ramune_end`（`end_session` を適用する。グラフ自体は削除・
  変更しない）を追加する。どちらも Orchestrator 専用にする（`tools/ramune/hooks` の
  PreToolUse hook で機械強制。Planner/Worker は ramune モードが稼働している間だけ意味を持つ
  ロールであり、そのロール自身がモードの出入りを切り替えられると循環が生まれるため）
- `tools/ramune/hooks/src/mode.ts` の判定条件を、環境変数 `RAMUNE_MODE` から
  `.ramune/graph.json` の `session.active` を直接読む方式に置き換える。hook は呼び出しごとに
  毎回ファイルを同期的に読む（読み込みコストは許容する）。グラフファイルが無ければ非稼働、
  `session.active` が読み取れる形であればその値、JSON として壊れている・`Graph` の形を
  満たさない・`session.active` が無い場合は判定不能としてエラーで拒否する（非稼働に丸めない）。
  グラフの配置規約（`.ramune/graph.json` というパス）と形の判定基準（`isGraphShape`）は
  `@webapp-blueprint/ramune-graph` の `persisted-graph.ts` に一箇所だけ持ち、`tools/ramune/mcp-server`
  の `GraphStore` と `tools/ramune/hooks` の両方がこれを共有する
- 環境変数 `RAMUNE_MODE` による判定は削除する。`isRamuneModeActive` の関数シグネチャは
  `(env) => boolean` から `(repositoryRoot: string) => boolean` に変わる

## 理由と捨てた代替案

### 環境変数を維持しつつ「後から書き換える」経路を足す案を採らなかった理由

MCP ツールや hook プロセスから親（Orchestrator）プロセスの環境変数を書き換える標準化された
手段は無い。仮に何らかの IPC でそれを実現しても、「モードの状態がどこに真に存在するか」が
プロセス間 IPC の同期に依存する複雑な仕組みになり、ADR 0001 が避けようとした「状態が
プロセスの生死に依存する」問題を IPC の生死に置き換えるだけで解決にならない。

### session を別ファイル（例: `.ramune/session.json`）に分離しなかった理由

グラフとモードを別ファイルに分けると、「グラフはあるがモードの状態ファイルが無い」
「両方あるが内容が矛盾している」といった、2ファイル間の整合性を新たに管理する必要が生まれる。
モードは「このグラフが今アクティブに実行されているか」という、グラフそのものに関する事実で
あり、グラフと同じファイルの中の1フィールドとして持つ方が自然である。原則1（状態の外在化）が
求めるのも「グラフが唯一の真実源であること」であり、真実源を2つに増やさない。

### `start_session` / `end_session` を独立した専用ファイルの読み書きにせず GraphOperation にした理由

`ramune_record_result` / `ramune_request_replan` が `set_result` / `block` という
GraphOperation を1種類だけ組み立てる専用ツールであるのと同じ形にすることで、「差分操作の
適用は必ず `applyOperations` を経由する」という一貫した経路を保てる。session の変更は DAG
不変条件（サイクル禁止等）に影響しないため `findInvariantViolations` の対象にはならないが、
前提条件違反（多重開始・多重終了)を型付きエラーで拒否する仕組みは他の操作と共通化できる。

## 影響

- `tools/ramune/graph`: `Graph` に `session: GraphSession`、新しい操作
  `start_session` / `end_session`、新しいドメイン層の共有ユーティリティ `persisted-graph.ts`
  （`GRAPH_FILE_RELATIVE_PATH` / `isGraphShape`）が増える。既存のグラフ JSON
  （`session` フィールドを持たないもの）は `isGraphShape` が偽を返し、壊れているものとして
  扱われる（default 値で埋めない）
- `tools/ramune/mcp-server`: 7番目・8番目の MCP ツール `ramune_start` / `ramune_end` が増える。
  `GraphStore` に `loadOrCreate(goal)` を追加する
- `tools/ramune/hooks`: `mode.ts` の判定条件が環境変数からファイルベースに変わる。
  `policy.ts` の権限表に Orchestrator 専用ツールの行が増える
- `AGENTS.md`「ramune モード」節の「入り方」列を `RAMUNE_MODE=1` から `ramune_start` の呼び出しに
  更新する。`docs/recipes/tools/ramune.md` を新しい機構に書き換え、この ADR への参照を残す
- `.claude/agents/planner.md` / `worker.md` の「前提: ramune モードに入っていること」節を
  `RAMUNE_MODE=1` の記述から書き換える
- `mise run ramune:status` を新設する（グラフの有無・稼働状態・goal・ノード数を表示する
  読み取り専用コマンド）。「今モードに入っているか分からない」という環境変数版の弱点への対応
