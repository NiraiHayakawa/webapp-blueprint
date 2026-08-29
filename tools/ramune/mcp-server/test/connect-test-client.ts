// テストの土台: 一時ディレクトリを repositoryRoot にした ramune サーバーを
// InMemoryTransport で起動し、実際の MCP クライアントを接続する。
// docs/principles/test-public-contract-only.md に従い、各ツールのテストは
// この実クライアント経由で「公開契約（MCP のリクエスト/レスポンス）」だけを見る。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Client,
  InMemoryTransport,
  type CallToolRequestParams,
} from "@modelcontextprotocol/client";
import type { Server } from "@modelcontextprotocol/server";
import { expect } from "vitest";
import { z } from "zod";
import { parseGraph, type GraphV2 } from "@webapp-blueprint/ramune-graph";
import { createRamuneServer } from "../src/server.ts";
import { GraphStore } from "../src/store.ts";

export interface TestClientHandle {
  readonly client: Client;
  readonly repositoryRoot: string;
  readonly close: () => Promise<void>;
}

export async function connectTestClient(
  options: { readonly repositoryRoot?: string } = {},
): Promise<TestClientHandle> {
  // repositoryRoot を渡された場合はそのディレクトリ（実 git リポジトリ等）を
  // store の根にする。後片付けは生成した側の責務なので消さない。
  const ownsRepositoryRoot = options.repositoryRoot === undefined;
  const repositoryRoot =
    options.repositoryRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "ramune-mcp-server-test-"));
  const store = new GraphStore({ repositoryRoot });
  // server.ts が意図的に非推奨の低レベル Server を使い続ける理由は
  // server.ts 冒頭のコメント参照（McpServer は zod 前提で契約 = JSON Schema
  // という ramune の要件を満たせない）。
  // oxlint-disable-next-line typescript/no-deprecated -- 上のコメント参照。
  const server: Server = createRamuneServer({ store });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "ramune-mcp-server-test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    repositoryRoot,
    close: async () => {
      await client.close();
      await server.close();
      if (ownsRepositoryRoot) {
        fs.rmSync(repositoryRoot, { recursive: true, force: true });
      }
    },
  };
}

// client.callTool() の戻り値型は、現行の CallToolResult 形と、後方互換用の
// { toolResult: unknown } 形（2024-10-07 プロトコル版との互換。
// CompatibilityCallToolResultSchema）の union になっている。ramune サーバーは
// 常に前者の形で、しかも text content だけを返す（server.ts の
// toCallToolResult 参照）。ここではその形をスキーマとして宣言し、外れた応答が
// 来たら parse がその場で投げる = fail-fast する。
type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

/** MCP `tools/call` の引数の形。SDK の契約型（CallToolRequestParams）から写す。 */
type ToolArguments = NonNullable<CallToolRequestParams["arguments"]>;

const textContentResultSchema = z.looseObject({
  content: z.array(z.looseObject({ type: z.literal("text"), text: z.string() })),
});

function readToolResultText(result: ToolCallResult): string {
  const [textBlock] = textContentResultSchema.parse(result).content;
  if (textBlock === undefined) {
    throw new Error("tool result に text content が無い");
  }
  return textBlock.text;
}

/**
 * 成功応答の JSON をデコードする。isError 応答は契約違反として落とす
 * （失敗を見たいテストは expectDomainRejection を使う）。
 */
export async function callToolJson<T = unknown>(
  handle: TestClientHandle,
  name: string,
  toolArguments: ToolArguments = {},
): Promise<T> {
  const result = await handle.client.callTool({ name, arguments: toolArguments });
  if (result.isError === true) {
    throw new TypeError(`tool "${name}" は成功するべきだった: ${readToolResultText(result)}`);
  }
  // SAFETY: 呼び出し側が期待する型 T はテストごとに異なるドメイン型であり、
  // ここでは textContentResultSchema で tool result の形（text content の存在）
  // までしか検証できない。中身のドメイン検証は呼び出し側テストのアサーションに委ねる。
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 上記 SAFETY のとおり、呼び出し側ごとに違うドメイン型へ写す境界をここ 1 箇所に閉じる
  return JSON.parse(readToolResultText(result)) as T;
}

/** ドメイン拒否（isError: true の text content）を観測し、メッセージ本文を返す。 */
export async function expectDomainRejection(
  handle: TestClientHandle,
  name: string,
  toolArguments: ToolArguments,
): Promise<string> {
  const result = await handle.client.callTool({ name, arguments: toolArguments });
  if (result.isError !== true) {
    throw new TypeError(`tool "${name}" は拒否されるべきだった`);
  }
  return readToolResultText(result);
}

/** JSON Schema 違反は McpError(InvalidParams) として transport 層で拒否される。 */
export async function expectSchemaViolation(
  handle: TestClientHandle,
  name: string,
  toolArguments: ToolArguments,
): Promise<void> {
  await expect(handle.client.callTool({ name, arguments: toolArguments })).rejects.toThrow(
    /JSON Schema/u,
  );
}

/**
 * グラフ全体を返すツール群の応答をデコードする。
 *
 * ドメイン層の `parseGraph` をそのまま通すので、テスト側にグラフ契約の写しを
 * 持たない（写しを持つと、契約が変わったときに本体とテストで別々に直す必要が
 * 生まれ、drift の余地になる）。
 */
export function parseGraphResponse(result: ToolCallResult): GraphV2 {
  const parsed = textContentResultSchema.parse(result).content;
  const [textBlock] = parsed;
  if (textBlock === undefined) {
    throw new Error("tool result に text content が無い");
  }
  return parseGraph(textBlock.text);
}
