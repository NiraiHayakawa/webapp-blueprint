// ramune MCP サーバーの Streamable HTTP 起動（ADR 0013 / 設計正本 §5）。
//
// - transport は NodeStreamableHTTPServerTransport（stateless。
//   sessionIdGenerator を与えない = session ヘッダ廃止の spec 2026-07-28 姿勢）。
//   1 つの Server + transport インスタンスが全クライアントのリクエストを処理する
// - port bind を二重起動の排他ロックとして使う。EADDRINUSE 等は
//   PortBindFailedError で即死する（自動リトライ・ポート再探索なし）
// - 起動時に graph 配置パスの所有を検査する（ownership.ts）
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createRamuneServer } from "./server.ts";
import type { GraphStore } from "./store.ts";
import { PortBindFailedError } from "./port-bind-failed-error.ts";
import { acquireGraphPathOwnership, releaseGraphPathOwnership } from "./ownership.ts";

const INTERNAL_SERVER_ERROR_STATUS = 500;

export interface StartRamuneHttpServerOptions {
  readonly store: GraphStore;
  readonly repositoryRoot: string;
  /** 固定ポート。省略（= フォールバック値の暗黙適用）は許さない（fail-fast）。 */
  readonly port: number;
}

export interface RunningRamuneHttpServer {
  readonly port: number;
  readonly close: () => Promise<void>;
}

/**
 * transport.handleRequest が応答を書けなかった場合の最後の防波堤。
 * 通常のプロトコルエラーは SDK 内部で JSON-RPC error として応答済み。
 */
async function handleHttpRequest(
  transport: NodeStreamableHTTPServerTransport,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    await transport.handleRequest(request, response);
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(INTERNAL_SERVER_ERROR_STATUS, { "content-type": "application/json" });
    }
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

async function listenOrThrow(httpServer: http.Server, port: number): Promise<void> {
  // listen は成功時にコールバック、失敗時に 'error' イベントで通知する Node の
  // 慣習的 API であり、promisify 可能な error-first コールバックの形をしていない。
  // ここだけが Promise への変換点。
  // oxlint-disable-next-line promise/avoid-new -- 上のコメント参照。
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", (error) => {
      reject(new PortBindFailedError(port, error));
    });
    httpServer.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });
}

async function closeQuietly(closeable: { close: () => Promise<void> }): Promise<void> {
  try {
    await closeable.close();
  } catch {
    // bind 失敗時 / 二重 close 時の後始末であり、close 自体の失敗は無視してよい。
  }
}

async function closeHttpServer(httpServer: http.Server): Promise<void> {
  // Server#close はコールバック API しか持たず、util.promisify も特に恩恵が無い
  // 単発の完了待ちのため直接 wrap する。
  // oxlint-disable-next-line promise/avoid-new -- 上のコメント参照。
  await new Promise<void>((resolve) => {
    httpServer.close(() => {
      resolve();
    });
  });
}

interface ConnectedRamuneServer {
  readonly server: ReturnType<typeof createRamuneServer>;
  readonly transport: NodeStreamableHTTPServerTransport;
}

async function createConnectedRamuneServer(store: GraphStore): Promise<ConnectedRamuneServer> {
  const server = createRamuneServer({ store });
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return { server, transport };
}

/**
 * ramune の単一共有 HTTP サーバーを起動する。
 *
 * stateless transport は 1 リクエスト = 1 処理であり、session affinity を
 * 必要としない。複数セッション・複数 worktree はすべてこの 1 プロセスへ接続する
 * （「writer が 1 本」を transport の構造で保証する。§5）。
 */
export async function startRamuneHttpServer(
  options: StartRamuneHttpServerOptions,
): Promise<RunningRamuneHttpServer> {
  const { store, repositoryRoot, port } = options;

  await acquireGraphPathOwnership(repositoryRoot);

  const { server, transport } = await createConnectedRamuneServer(store);
  const httpServer = http.createServer((request, response) => {
    void handleHttpRequest(transport, request, response);
  });

  try {
    await listenOrThrow(httpServer, port);
  } catch (error) {
    // bind 失敗時は server / transport も閉じてから落ちる（半端な状態を残さない）
    await closeQuietly(server);
    throw error;
  }

  return {
    port,
    close: async () => {
      await closeQuietly(transport);
      await closeQuietly(server);
      await closeHttpServer(httpServer);
      await releaseGraphPathOwnership(repositoryRoot);
    },
  };
}
