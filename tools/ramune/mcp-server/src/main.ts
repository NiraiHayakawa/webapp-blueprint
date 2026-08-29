#!/usr/bin/env node
// ramune MCP サーバーの起動スクリプト。Streamable HTTP（stateless）で listen し、
// 複数セッション・複数 worktree が同一サーバー = 同一 writer を共有する
// （ADR 0013 / 設計正本 §5）。stdio transport は廃止した。
//
// port は起動引数 `--port <n>` で必須。既定値のフォールバックは存在しない
// （docs/principles/fail-fast.md「デフォルト値フォールバックの禁止」。port を
// 暗黙で決めると、どのサーバーが canonical かが観測できなくなる）。mise task
// （mcp:ramune:serve）が固定ポートを渡す。テストは動的ポートを自分で確保する。
//
// 起動手順:
//   1. graph 配置パス（canonical リポジトリルート）の所有検査（ownership.ts）
//   2. Streamable HTTP の listen（bind 失敗 = 二重起動は PortBindFailedError で即死）
//
// import/no-nodejs-modules は apps/api と同じ扱い（必要な行だけ個別に抑制）。
// oxlint-disable-next-line import/no-nodejs-modules -- 上のコメント参照。
import process from "node:process";
import { startRamuneHttpServer } from "./http-server.ts";
import type { RunningRamuneHttpServer } from "./http-server.ts";
import { GraphStore } from "./store.ts";

/** シグナル受信時の終了処理。close の成否に関わらずプロセスは終了する。 */
async function shutdown(running: RunningRamuneHttpServer): Promise<void> {
  try {
    await running.close();
  } finally {
    process.exit(0);
  }
}

const MAX_PORT_NUMBER = 65_535;

function parsePort(argv: readonly string[]): number {
  const index = argv.indexOf("--port");
  const value = index === -1 ? undefined : argv[index + 1];
  const parsed = value === undefined ? Number.NaN : Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_PORT_NUMBER) {
    throw new Error(
      "起動引数に --port <1-65535> が必須である（既定値へのフォールバックは存在しない。" +
        "運用では mise run mcp:ramune:serve が固定ポートを渡す）",
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const port = parsePort(process.argv);
  const repositoryRoot = process.cwd();
  const store = new GraphStore({ repositoryRoot });
  const running = await startRamuneHttpServer({ store, repositoryRoot, port });
  // listen の完了は CLI の観測可能な結果であり、運用者・統合側が起動を確認する
  // ための手がかりである（デバッグ用の残留 log とは種類が異なる）。
  // oxlint-disable-next-line eslint/no-console -- 上のコメント参照。
  console.log(`ramune MCP server listening on http://127.0.0.1:${String(running.port)}/mcp`);

  // 終了時に graph 配置パスの所有マーカーを取り除く。取り除かれないまま死んだ
  // 場合でも、次の起動はマーカーの pid の生死で stale 判定して引き継げる
  // （ownership.ts）。ただし正常系ではマーカーを残さない方が観測誤りが無い
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdown(running);
    });
  }
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    // プロセス起動失敗（port 未指定 / bind 失敗 / 所有検査の不一致）を stderr に
    // 報告して非ゼロ終了する、CLI エントリポイントの致命的エラー報告。
    // oxlint-disable-next-line eslint/no-console -- 上のコメント参照。
    console.error(error);
    process.exitCode = 1;
  }
}

void run();
