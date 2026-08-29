// GraphStore の bind 失敗: ramune の MCP サーバーが指定ポートで listen でき
// なかった（EADDRINUSE 等）。ADR 0013「port bind を二重起動の排他ロックとして
// 使う」の受け皿であり、2 個目のサーバーはこのエラーで loudly に死ぬ。
// 自動リトライ・ポート再探索は行わない（docs/principles/fail-fast.md）。
//
// store.ts 周辺のエラークラスと同じく、1 ファイル 1 クラスの原則
// （eslint/max-classes-per-file）に合わせるためであり、拡張はファイルの追加で
// 表現する（docs/principles/extension-adds-files.md）。

export class PortBindFailedError extends Error {
  readonly port: number;
  readonly cause_: unknown;

  constructor(port: number, cause: unknown) {
    super(
      `ポート ${String(port)} で ramune MCP サーバーを起動できなかった（既に別のサーバーが` +
        "listen している可能性。ADR 0013 の port bind 排他により二重起動は即死する）",
    );
    this.name = "PortBindFailedError";
    this.port = port;
    this.cause_ = cause;
  }
}
