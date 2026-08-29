# レシピ: codegraph を MCP として使う

原則: [`docs/principles/knowledge-flows-back.md`](../principles/knowledge-flows-back.md)(知見は正本へ還流する)の「検索」要素。`docs/design/README.md` 相当の位置づけで、blume MCP が `docs/` を検索可能にするのと同じ発想を、コード自体の検索可能性に対して適用したもの

## 何のためのレシピか

`docs/plan/Template/20260807_template-design.md` §7「コンテキスト予算」は、常時ロード枠(ルート `AGENTS.md`)が希少で、on-demand で引ける枠(MCP)が潤沢であることを前提に置く。blume MCP は `docs/` をこの潤沢枠に載せるが、**コードそのもの**を潤沢枠に載せる仕組みは別に要る。エージェントがコードベースの構造(ある symbol がどこで定義され、どこから呼ばれているか)を知るために、毎回ファイルを総当たりで `rg` するのは、on-demand で引けるはずの情報を都度読み込みコストの高い探索に変換してしまっている状態である。codegraph はこの探索をグラフクエリに変える。

## ツール(2026-08-08 に GitHub リポジトリ本体で確認)

| 項目                           | 内容                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| パッケージ                     | `@colbymchenry/codegraph`、1.5.0                                                                                                                                                                         |
| ライセンス                     | MIT                                                                                                                                                                                                      |
| self-contained                 | Node ランタイムを bundle しており、別途ビルド不要(`bundled Node runtime — nothing to compile`)                                                                                                           |
| 100% local                     | tree-sitter でパースしたシンボル / エッジ / ファイルを `.codegraph/codegraph.db`(SQLite)にすべて保存する。API キー・外部サービスへの依存が無い(`no API keys, no external services`)                      |
| 既定の MCP ツール              | サーバー起動時に見える MCP tool は **`codegraph_explore` の 1 本だけ**。`node` / `search` / `callers` 等の個別ツールも存在するが既定では非表示で、`CODEGRAPH_MCP_TOOLS` 環境変数を設定したときだけ増える |
| プライベートリポジトリでの動作 | ソースコードやシンボル名は外部送信されず、ローカル解析で完結する設計。                                                                                                                                   |

## テレメトリの既定 off

codegraph は**既定でテレメトリが有効**(インストール時に visible な on/off トグルを見せ、初回送信前に stderr へ通知する形)。無効化する環境変数は `CODEGRAPH_TELEMETRY=0` または cross-tool 標準の `DO_NOT_TRACK=1` のいずれか。

テンプレートはこれを既定 off にする(`.mcp.json` の `codegraph` サーバー定義に `"env": { "CODEGRAPH_TELEMETRY": "0" }` を持たせる)。理由は原則9・原則4 と同じ発想で、**外部送信の既定を「送る」側にしない**ことを明示的な設定として残すため。テレメトリの収集内容自体は匿名(リポジトリ情報・IP を含まない)だが、匿名であることと送信して良いことは別の判断であり、本テンプレートは「送らない」を既定にする。

## 配線

`.mcp.json` に 1 サーバーとして登録する(§6「MCP をテンプレートに配線する」と同じ形):

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@colbymchenry/codegraph@1.5.0", "serve", "--mcp"],
      "env": {
        "CODEGRAPH_TELEMETRY": "0"
      }
    }
  }
}
```

blume MCP と同じく、接続の承認は各エージェントの承認フローに委ねる。テンプレートは登録するだけで自動承認はしない。

## 落とし穴

- `CODEGRAPH_MCP_TOOLS` を設定して個別ツール(`node` / `search` / `callers` 等)を増やすと、常時見えるツール一覧が増えてエージェントの選択コストが上がる。既定の `codegraph_explore` 1 本という設計は「ツールを絞ることでエージェントに正しい入口を 1 つだけ示す」という意図であり、安易に増やさないこと
- auto-sync が既定で有効(ファイル変更を監視してグラフを更新する)なため、大量のファイルを一括生成・削除する操作(スキャフォルディング等)の直後は再インデックスの完了を待つ必要がある。完了前にクエリすると古い状態を返す可能性がある
