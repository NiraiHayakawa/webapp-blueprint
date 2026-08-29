# 0004. ハーネスの起動経路が依存インストールを自分で保証する

- 状態: 承認済み
- 決定日: 2026-08-10

## 文脈

`node_modules/` は `.gitignore` の対象であり、git worktree ごとに空から始まる。一方 [`.mcp.json`](../../.mcp.json) の ramune エントリは Claude Code のセッション開始時に `mise run mcp:ramune` を起動し、その先の `tools/ramune/mcp-server` は `@modelcontextprotocol/sdk`（外部パッケージ）とワークスペースパッケージの解決を必要とする。

2 つの失敗を実測した。どちらも**壊れていることが観測できないまま進む**形の失敗であり、fail-fast（`docs/principles/fail-fast.md`）の逆を向いている。

1. **MCP サーバが起動時に落ち、そのセッションでは ramune のツールが最初から存在しない。** エージェント側から見えるのは「`mcp__ramune__*` が無い」という結果だけで、原因は報告されない。`ramune_start` を呼べないため ramune モードに入る手段自体が失われ、Planner / Worker も（同じツールしか持たないため）動かせない。
2. **PreToolUse hook も同じ依存を import しており、依存が無いと import の時点でプロセスが落ちる。** Claude Code は hook の exit code 1 を non-blocking error として扱ってツール呼び出しを素通りさせるため、これは fail-open である。[ADR 0003](0003-ramune-mode-session-field.md) が定めた「判定不能なら deny する」という fail-closed の保証が、依存の欠落という経路だけ抜けていた。

起動経路に install を挟むコストは、pnpm store が温まった状態では no-op に近く、MCP の起動タイムアウトに対して十分小さい。

## 決定

**ハーネス（MCP サーバ・ramune のツール群）の起動経路は、自分が動くための前提を自分で満たす。** 具体的に次の 3 つを決める。

1. `mise run install`（`pnpm install --frozen-lockfile`）を導入し、`.mcp.json` が起動する mise task は `depends` にこれを持つ。ramune の周辺 task（`ramune:status` / `viewer:dev`）と `docs:mcp` も同じ扱いにする。install の出力は stdout ではなく stderr に落とす（stdout は MCP の stdio トランスポートに予約されているため。pnpm install は進捗を stdout に書く）
2. **PreToolUse hook のソースは `node_modules` の解決を必要とする import を持たない。** hook は install より前に発火しうるため、依存の有無に関係なく起動できる必要がある。`tools/ramune/hooks` は外部依存を持たないドメイン層（`tools/ramune/graph`）を相対パスで直接 import し、`dependencies` を持たない
3. 上の 2 つを [`tests/policy/harness-bootstrap/`](../../tests/policy/harness-bootstrap/harness-bootstrap.check.ts) が機械強制する（原則 4「規約は機械で縛る」）。検証対象は `.mcp.json` と `mise.toml` の対応、および `tools/ramune/hooks/src/` の import 指定子

## 理由と捨てた代替案

`--frozen-lockfile` を付けるのは、lockfile と manifest の食い違いを install が黙って解消しないため（原則 10「依存は完全固定する」）。起動経路の副作用で pin が崩れるのは、この ADR が消そうとしている silent な失敗と同じ種類の事故になる。

- **代替案 A: `.envrc`（direnv）で install する。** `cd` した瞬間に環境を揃える形は本来望ましいが、Claude Code が `.claude/worktrees/` に作る worktree はターミナルを経由しないため direnv が走らない。今回の事故がまさにその経路で起きている
- **代替案 B: SessionStart hook で install する。** セッション開始時という点では自然だが、MCP サーバの接続と SessionStart hook の実行順序は保証されていない。install が終わる前に MCP が起動されれば初回セッションは救われず、「たまたま間に合えば動く」挙動になる。起動経路自身に前提を持たせる形は順序に依存しない
- **代替案 C: hook を「依存が解決できなければ deny」にして fail-closed を徹底する。** 採らない。ramune を使う意思のない利用者（clone しただけ・ramune 非稼働）が最初から何も編集できなくなり、これは [`docs/recipes/tools/ramune.md`](../recipes/tools/ramune.md) が「避けるべき失敗の形」として明記している状態そのものである。さらに `Bash` も拒否対象なので、install を実行して回復する経路まで塞がる自己ロックになる。「判定不能なら deny」は**モードが稼働中と判定できたうえで役割が判定できない場合**の規律であり、モードの判定自体を依存の有無に委ねてよいという意味ではない。決定 2（hook を依存に依存させない）はこの穴を「deny に倒す」のではなく「そもそも失敗しない」形で閉じている
- **代替案 D: `[tasks.check].depends` にも install を足す。** 採らない。ci-gate の policy が `[tasks.check].depends` と CI の `matrix.task` の完全一致を要求しており、CI 側に install だけを行う matrix job を追加することになる。CI は各 job で明示的に `pnpm install --frozen-lockfile` を実行しているため二重になる。`mise run check` は依存が無ければ loud に失敗する（silent に緑にならない）ので、この ADR が対象とする失敗の形には当たらない
- **代替案 E: hooks は パッケージ名の import を維持し、`tools/ramune/graph` をバンドルしてコミットする。** 生成物をコミットしない（原則 1）に反する

## 影響

- [`mise.toml`](../../mise.toml): `[tasks.install]` を追加し、`mcp:ramune` / `ramune:status` / `viewer:dev` / `docs:mcp` が `depends` する。ルート [`AGENTS.md`](../../AGENTS.md) の「コマンド」表にも入口として載せる
- [`tools/ramune/hooks/`](../../tools/ramune/hooks/src/mode.ts): `@webapp-blueprint/ramune-graph` をパッケージ名ではなく相対パスで import する。`package.json` から `dependencies` が消える。今後 hooks に外部パッケージを足す判断は、この ADR の決定 2 と正面から衝突する（足すなら ADR で上書きする）
- [`tests/policy/harness-bootstrap/`](../../tests/policy/harness-bootstrap/harness-bootstrap.check.ts): 新規追加。あわせて `tests/policy/manifest-parsing/mise-tasks.ts` の `extractCheckDependsTasks` を任意のタスク名を引ける `extractTaskDepends` に一般化した（`[tasks.check]` 専用ではなくなったため）
- [`docs/recipes/tools/ramune.md`](../recipes/tools/ramune.md): 「新しい worktree で最初に何が要るか」を前提として明記する
- ADR 0003 が定めた fail-closed の範囲は変わらない。この ADR は「モード判定に到達する前にプロセスが落ちる」経路を塞ぐものであり、稼働中の役割強制の規律には触れていない
