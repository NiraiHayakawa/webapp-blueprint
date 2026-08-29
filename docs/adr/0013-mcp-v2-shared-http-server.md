# 0013. ramune の MCP サーバは spec 2026-07-28 の単一共有 HTTP サーバにする

- 状態: 承認済み
- 決定日: 2026-08-24

## 文脈

ramune の MCP サーバは stdio transport であり、Claude Code のセッションごとに `mise run mcp:ramune` でプロセスが spawn される。
ADR 0010 は「グラフの writer は単一プロセス」を前提に in-process 直列化を採ったが、stdio 配線ではその前提が構造的に破れる。別の worktree でセッションを開いた瞬間に 2 個目のサーバプロセスが立ち、双方が同じ revision から atomic rename できてしまう。
また、駆動主体を agent に依存させない方針（設計正本 §1）は、将来の複数セッション・runner がグラフを共有できる transport を要求する。

## 決定

- MCP SDK v2（spec revision 2026-07-28、通称 MCP v2）へ移行し、transport を stdio から Streamable HTTP に変える。spec 2026-07-28 は stateless（session ヘッダ廃止・リクエストが self-contained）であり、複数クライアントが session affinity なしで単一サーバへ接続できる
- `.mcp.json` の ramune エントリを `type: "http"` にし、すべてのセッション・worktree が同一サーバ = 同一 writer を共有する
- **port bind を二重起動の排他ロックとして使う**。2 個目のサーバは bind に失敗して loudly に死ぬ。サーバは起動時に graph 配置パスの所有を検査し、不一致は fail-closed で拒否する
- サーバの起動は `mise run mcp:ramune:serve`（`depends = ["install"]`。ADR 0004 の bootstrap 保証を維持）。サーバ不在時のセッションでは ramune ツールが現れず、接続失敗は明確なエラーになる。自動 spawn による fallback は作らない

設計の正本は [docs/plan/Ramune/20260824_parallel-execution.md](../plan/Ramune/20260824_parallel-execution.md)（§5）。

## 理由と捨てた代替案

「writer が 1 本」を仮定ではなく構造にできる。多重起動を検出して守る仕組み（クロスプロセスのファイルロック等）を足すのではなく、多重起動する動機そのものを消す（全クライアントが 1 本のサーバに繋げばよい）方向であり、機構が減る。

- 代替案 A（stdio のまま、グラフ所有の lockfile で二重起動を検出する）: 検出はできるが、2 個目のセッションでは ramune が一切使えない（そのセッションの専属サーバが起動を拒否されるため）。複数セッション共有という要求を満たさない
- 代替案 B（多重 writer を許し、ストア層にクロスプロセス CAS / ファイルロックを足す）: ADR 0010 代替案 E で退けた複雑さがすべて戻る。stateless 化はプロトコルの性質であり、ファイルへの read-modify-write の直列化を何も提供しないため、v2 採用は多重起動の根拠にならない
- 代替案 C（旧 spec のまま HTTP にする）: `Mcp-Session-Id` による stateful な session 管理を自前で正しく扱う負担が残る。どのみち SDK の移行が必要なら、stateless の新 spec に直接移る方が実装が薄い

## 影響

- 本 ADR は設計の採用であり、実装はこれから行う。実装 PR は次を同梱する: SDK v2 への移行（パッケージ分割を含む）、`.mcp.json` の ramune エントリ変更、`mise.toml` の `mcp:ramune:serve` タスク、[docs/recipes/tools/ramune.md](../recipes/tools/ramune.md) のサーバ起動手順
- SDK v2 の採用時は公開から 7 日以上経過していることを確認する（`docs/principles/pin-dependencies.md`）
- ADR 0004（起動経路が依存インストールを自分で保証する）の保証対象が「セッションごとの spawn」から「serve タスク」に移る。ADR 0004 自体の決定は変えない
- hook（PreToolUse）は MCP サーバとは独立に各セッションで動き続けるため、この決定の影響を受けない（ADR 0004 の node_modules 非依存の性質は維持する）
