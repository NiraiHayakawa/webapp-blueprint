# WP5 検証・受入仕様書: SDK v2 + Streamable HTTP

- 対象: `tools/ramune/mcp-server/`（`package.json` / `server.ts` / `main.ts` / `tool-definition.ts` / `connect-test-client.ts`）、`pnpm-workspace.yaml`（catalog）、`mise.toml`、`.mcp.json`
- 設計正本: [20260824_parallel-execution.md](../20260824_parallel-execution.md) §5

## SDK バージョンと公開日の確認（docs/principles/pin-dependencies.md）

| パッケージ                   | 版    | 公開時刻 (UTC)           | 経過日数（2026-08-24 時点） |
| ---------------------------- | ----- | ------------------------ | --------------------------- |
| @modelcontextprotocol/server | 2.0.0 | 2026-07-27T23:55:22Z     | 28 日 ✓                     |
| @modelcontextprotocol/client | 2.0.0 | 同時刻（同一リリース列） | 28 日 ✓                     |
| @modelcontextprotocol/node   | 2.0.0 | 同時刻（同一リリース列） | 28 日 ✓                     |

7 日待機の原則を満たしていることを確認済み。

**パッケージ分割**: spec 2026-07-28（MCP v2）は `@modelcontextprotocol/{core, server, node, client}` へのパッケージ分割として公開されている（`@modelcontextprotocol/sdk` 自体は 1.x 継続・latest 1.30.0）。ADR 0013 の「パッケージ分割（@modelcontextprotocol/server 等）」はこの形を指す。依存は server + node を dependencies、client を devDependencies（テスト専用）として catalog pin している。zod は v2 が ^4.2.0 を要求し、catalog の 4.4.3 が適合する。

## 実装内容

### transport の置き換え（§5）

- **Streamable HTTP（stateless）**: `NodeStreamableHTTPServerTransport`（@modelcontextprotocol/node）を `sessionIdGenerator: undefined`（= session ヘッダ廃止の stateless モード）+ `enableJsonResponse: true` で使用。1 つの Server / transport インスタンスが全クライアントのリクエストを処理し、複数セッション・複数 worktree が同一 writer を共有する
- **port bind 排他（ADR 0013）**: bind 失敗（EADDRINUSE 等）は `PortBindFailedError` で即死。自動リトライ・ポート再探索は存在しない。bind 失敗時は Server / transport を閉じてから落ちる（半端な状態を残さない）
- **graph 配置パスの所有検査**: 起動時に `acquireGraphPathOwnership()` が (a) repositoryRoot が git リポジトリルートであること、(b) `.ramune/server-owner.json` マーカーの pid が生存していないことを検査する。不一致は `GraphPathOwnershipError` で fail-closed。マーカーの pid が死んでいれば crash 後の再起動として引き継ぐ。正常終了（SIGINT/SIGTERM 含む）ではマーカーを取り除く
- **自動 spawn フォールバックなし**: サーバー不在のセッションでは ramune ツールが現れず、接続失敗がそのまま明確なエラーになる

### 低レベル構成の維持

「契約 = JSON Schema、ajv strict 検証 → handle」という構成と 13 ツールのハンドラを維持。差分:

1. import 元を v2 パッケージへ（`Tool` 型は `@modelcontextprotocol/server`）
2. `McpError` は v2 で廃止されたため、JSON Schema 違反・未知ツールは `ProtocolError` + `ProtocolErrorCode.{InvalidParams, MethodNotFound}` で投げる（JSON-RPC error response としてワイヤに出る。メッセージ本文は温存されるためクライアント側の `/JSON Schema/u` アサーション等がそのまま機能する）
3. `setRequestHandler(CallToolRequestSchema, ...)` → `setRequestHandler("tools/call", ...)`（v2 はメソッド名文字列 + 型付きハンドラの形）

`Tool["inputSchema"]` は v2 では JSON Schema の厳格な構造的 union になり、oneOf / const / enum を含む手書きリテラルが直接入らない。このため著述側の型を緩い `InputSchema`（Record）にし、ListTools 応答への適合だけを server.ts の `toSdkInputSchema()` 1 箇所で行う。

### mise.toml / .mcp.json

- `[tasks."mcp:ramune"]`（stdio）を削除し、`[tasks."mcp:ramune:serve"]` を追加。`depends = ["install"]`（ADR 0004 の bootstrap 保証を serve 経路へ移設）。port はタスク定義内で固定（**8642**）: `node tools/ramune/mcp-server/src/main.ts --port 8642`
- `.mcp.json` の ramune エントリを `"type": "http", "url": "http://localhost:8642/mcp"` へ置換（blume-docs エントリと同じ形）
- `ramune:status` task は v2 グラフ（session.state / revision 表示）で動作

## 変更ファイル一覧

### 変更

- `tools/ramune/mcp-server/package.json` — 依存の v2 化
- `tools/ramune/mcp-server/src/server.ts` — v2 imports、ProtocolError への移行、setRequestHandler 形式、toSdkInputSchema
- `tools/ramune/mcp-server/src/tool-definition.ts` — InputSchema 型導入
- `tools/ramune/mcp-server/src/main.ts` — stdio 廃止、--port 必須化、所有検査 + HTTP 起動、シグナルハンドラ
- `tools/ramune/mcp-server/src/tools/*.ts`（13 ファイル）— `Tool` 型 import 元の張り替え
- `tools/ramune/mcp-server/test/connect-test-client.ts` — Client / InMemoryTransport の import 元張り替え
- `pnpm-workspace.yaml` — catalog 定義の入れ替え（公開日確認コメント付き）
- `mise.toml` — mcp:ramune:serve 追加・mcp:ramune 削除・関連コメント更新
- `.mcp.json` — ramune エントリを type: "http" へ

### 新規

- `src/http-server.ts` — startRamuneHttpServer（所有検査 → Server 構築 → stateless transport → listen）
- `src/port-bind-failed-error.ts`
- `src/graph-path-ownership-error.ts`
- `src/ownership.ts` — 所有マーカーの取得 / 解放
- `test/http-server.test.ts`

## テスト仕様・検証結果

検証コマンド:

```bash
pnpm --filter @webapp-blueprint/ramune-mcp-server test
pnpm --filter @webapp-blueprint/ramune-mcp-server typecheck
```

検証項目:

- HTTP 起動後に Streamable HTTP 経由で ramune_start / ramune_read_graph が呼べること（クライアント接続確認）
- 同一ポートでの二重起動が `PortBindFailedError` で即死すること
- 所有検査: リポジトリルートでない場所の拒否 / 生存所有者の拒否 / クラッシュした旧プロセスの所有権取得
- 正常終了時の所有マーカー解放

## 設計正本からの逸脱と理由

1. **「SDK v2」の実体はパッケージ分割である**。ADR 0013 の表記「SDK v2（spec revision 2026-07-28）」に対応する公開物は `@modelcontextprotocol/{core,server,node,client}@2.0.0` であり、`@modelcontextprotocol/sdk` パッケージ自体は 1.x のまま現役である。4 パッケージ構成へ追随した（ADR の括弧書き「@modelcontextprotocol/server 等」と整合）。
2. **所有検査の機構をマーカーファイル方式とした**。§5 は「graph の配置パスを自分の所有として検査」のみ規定し機構は未指定。port bind 排他（第一線）に加え、`.ramune/server-owner.json`（pid・root・起動時刻）の生存 pid 検査で「別ディレクトリから同じ配置パスへ起動した」ケースを塞ぐ。pid が死んでいる場合は crash 後再起動として引き継ぐ（fail-closed の対象は生きている競合のみ）。
3. **`enableJsonResponse: true` を指定した**。stateless 単発リクエストでは SSE ストリームを開く必要がなく、複数クライアント実装（curl / Claude Code / inspector）での観測性が上がるため。プロトコル上の差分ではない。
4. **stdio transport の削除**。ADR 0013 は transport を HTTP に「変える」としており、stdio 用コード（StdioServerTransport 利用経路）は削除した。node パッケージ自体は NodeStreamableHTTPServerTransport のために必要。
5. **固定 port を 8642 とした**。設計に値の指定がなく、blume-docs（4321）との衝突を避けて選択。変更は mise.toml と .mcp.json の 2 箇所のみ。

## 運用・統合仕様

- `NodeStreamableHTTPServerTransport.handleRequest(req, res)` の外側に catch があるが、通常のプロトコルエラーは SDK 内部で JSON-RPC error 応答として完結する。
- 所有マーカー（`.ramune/server-owner.json`）はコミットしない（`.gitignore` の `.ramune/` 扱いに従う）。crash 後の stale マーカーは次回起動が pid 生死で引き継ぐ。
- port 8642 を変える場合は `mise.toml`（serve task）と `.mcp.json`（url）の 2 箇所を必ず同時に変えること。片方だけの変更は接続失敗という明確なエラーで検出される。
