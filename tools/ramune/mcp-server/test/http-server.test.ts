// Streamable HTTP 起動の公開契約（ADR 0013 / 設計正本 §5）:
// 起動 → HTTP 経由でツールが呼べる、二重起動は bind 失敗で即死、
// graph 配置パスの所有検査（fail-closed）。
import net from "node:net";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { parseGraphResponse } from "./connect-test-client.ts";
import { GraphStore } from "../src/store.ts";
import { PortBindFailedError } from "../src/port-bind-failed-error.ts";
import { GraphPathOwnershipError } from "../src/graph-path-ownership-error.ts";
import { acquireGraphPathOwnership, releaseGraphPathOwnership } from "../src/ownership.ts";
import { startRamuneHttpServer, type RunningRamuneHttpServer } from "../src/http-server.ts";

// net.Server.address() は AddressInfo | string | null を返す（unix socket 経由なら
// string、listen 前なら null）。ここでは常に TCP の ephemeral port（listen(0, ...)）を
// 使うため、境界でこの形をパースし、以後は domain 値（port）だけで分岐する
// （anti-slop no-runtime-typeof: typeof での素の絞り込みをしない）。
const listeningAddressSchema = z.object({ port: z.number() });

/** 動的な空きポートを確保する（テスト専用。本番タスクは固定ポート）。 */
async function findFreePort(): Promise<number> {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const listeningAddress = listeningAddressSchema.parse(probe.address());
  probe.close();
  await once(probe, "close");
  return listeningAddress.port;
}

function makeRepositoryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-http-test-"));
  // ownership 検査は git リポジトリルートであることを要求するため、
  // .git を置いた形を作る
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  return root;
}

interface RunningFixture {
  readonly running: RunningRamuneHttpServer;
  readonly repositoryRoot: string;
  readonly close: () => Promise<void>;
}

async function startOnFreePort(): Promise<RunningFixture> {
  const repositoryRoot = makeRepositoryRoot();
  const store = new GraphStore({ repositoryRoot });
  const running = await startRamuneHttpServer({
    store,
    repositoryRoot,
    port: await findFreePort(),
  });

  const client = new Client({ name: "ramune-http-test-client", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(running.port)}/mcp`)),
  );

  return {
    running,
    repositoryRoot,
    close: async () => {
      await client.close();
      await running.close();
      fs.rmSync(repositoryRoot, { recursive: true, force: true });
    },
  };
}

async function connectSecondClient(port: number): Promise<Client> {
  const client = new Client({ name: "ramune-http-second-session", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(port)}/mcp`)),
  );
  return client;
}

async function startGoalAndReadGraph(client: Client, goal: string) {
  await client.callTool({ name: "ramune_start", arguments: { goal } });
  const result = await client.callTool({ name: "ramune_read_graph", arguments: {} });
  return parseGraphResponse(result);
}

describe("ramune MCP HTTP サーバー: ツール呼び出し", () => {
  let fixture: RunningFixture | undefined;

  afterEach(async () => {
    if (fixture !== undefined) {
      await fixture.close();
    }
  });

  it("起動後、HTTP 経由で ramune_start / ramune_read_graph が呼べる", async () => {
    expect.hasAssertions();
    fixture = await startOnFreePort();

    const client = await connectSecondClient(fixture.running.port);
    try {
      const graph = await startGoalAndReadGraph(client, "HTTP 経由のゴール");
      expect(graph.version).toBe(2);
      expect(graph.goal).toBe("HTTP 経由のゴール");
      expect(graph.session.state).toBe("active");
    } finally {
      await client.close();
    }
  });
});

describe("ramune MCP HTTP サーバー: port bind 排他", () => {
  let fixture: RunningFixture | undefined;

  afterEach(async () => {
    if (fixture !== undefined) {
      await fixture.close();
    }
  });

  it("同じポートでの二重起動は PortBindFailedError で即死する（port bind 排他）", async () => {
    expect.hasAssertions();
    fixture = await startOnFreePort();

    const repositoryRoot = makeRepositoryRoot();
    try {
      const secondStore = new GraphStore({ repositoryRoot });
      await expect(
        startRamuneHttpServer({
          store: secondStore,
          repositoryRoot,
          port: fixture.running.port,
        }),
      ).rejects.toThrow(PortBindFailedError);
    } finally {
      fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});

describe("graph 配置パスの所有検査（§5 fail-closed）", () => {
  let repositoryRoot: string;

  afterEach(async () => {
    if (repositoryRoot) {
      await releaseGraphPathOwnership(repositoryRoot);
      fs.rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  it("git リポジトリルートでない場所は拒否される", async () => {
    expect.hasAssertions();
    repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-not-root-"));

    await expect(acquireGraphPathOwnership(repositoryRoot)).rejects.toThrow(
      GraphPathOwnershipError,
    );
  });

  it("生きている所有者がいる場合は拒否され、死んでいる場合は引き継げる", async () => {
    expect.hasAssertions();
    repositoryRoot = makeRepositoryRoot();

    // 自分自身（生存プロセス = このテストプロセス）を擬似的な別所有者として記録
    fs.mkdirSync(path.join(repositoryRoot, ".ramune"), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryRoot, ".ramune", "server-owner.json"),
      JSON.stringify({
        pid: process.pid,
        repositoryRoot,
        startedAt: "2026-08-24T00:00:00Z",
      }),
    );

    await expect(acquireGraphPathOwnership(repositoryRoot)).rejects.toThrow(
      GraphPathOwnershipError,
    );

    // 所有者が死んでいれば引き継げる（crash 後の再起動）
    fs.writeFileSync(
      path.join(repositoryRoot, ".ramune", "server-owner.json"),
      JSON.stringify({
        pid: 2_147_000_000,
        repositoryRoot,
        startedAt: "2026-08-24T00:00:00Z",
      }),
    );
    await expect(acquireGraphPathOwnership(repositoryRoot)).resolves.toBeUndefined();
  });
});
