// ramune の MCP サーバー本体。
//
// SDK v2（spec revision 2026-07-28。パッケージ分割後の
// @modelcontextprotocol/server）の低レベル Server を使う。高レベルの
// McpServer.registerTool は入力スキーマを zod からしか受け取れず、「契約 = JSON
// Schema そのもの」という ramune の要件（contract/README.md）を満たせないため
// 採らない。ここでは ListTools の応答と ajv の実行時検証の両方に、各ツールが
// 持つ同一の inputSchema オブジェクトをそのまま使う。
//
// transport はこのモジュールでは生成しない（stdio / Streamable HTTP の差異は
// 起動側 = http-server.ts / 将来の WP5 配線が担う）。Server は transport 非依存。
import { ProtocolError, ProtocolErrorCode, Server } from "@modelcontextprotocol/server";
import type { CallToolRequest, CallToolResult, Tool } from "@modelcontextprotocol/server";
import { Ajv, type ErrorObject } from "ajv";
import type { GraphStore } from "./store.ts";
import type { InputSchema, ToolDefinition } from "./tool-definition.ts";
import { abandonAssignmentTool } from "./tools/abandon-assignment.ts";
import { advanceIntegrationTool } from "./tools/advance-integration.ts";
import { applyOpsTool } from "./tools/apply-ops.ts";
import { claimIntegrationTool } from "./tools/claim-integration.ts";
import { claimReadyTool } from "./tools/claim-ready.ts";
import { endTool } from "./tools/end.ts";
import { readGraphTool } from "./tools/read-graph.ts";
import { recordIntegrationOutcomeTool } from "./tools/record-integration-outcome.ts";
import { recordResultTool } from "./tools/record-result.ts";
import { requestReplanTool } from "./tools/request-replan.ts";
import { resumeTool } from "./tools/resume.ts";
import { startTool } from "./tools/start.ts";
import { submitCandidateTool } from "./tools/submit-candidate.ts";
import { type DomainRejection, isDomainRejection } from "./domain-rejection.ts";

// tools/call が運ぶ検証前の引数。MCP SDK が持つリクエスト契約から導出する
// （同じ形を Record<string, unknown> として自前で書き直すと、SDK 側が形を
// 変えたときに黙ってずれる）。
type CallToolArguments = NonNullable<CallToolRequest["params"]["arguments"]>;

/**
 * ドメインの前提条件違反・不変条件違反・fence / revision の不一致は「入力の形は
 * 正しいが、ドメインの状態として拒否される」ケースであり、JSON Schema 検証の失敗
 * （形が壊れている = McpError(InvalidParams)）とは種類が異なる。ツール実行結果と
 * して isError: true で返す。呼び出し側（Orchestrator / Planner / Worker /
 * Integrator）が違反の内容を読んで次の一手を判断できる形にするためであり、
 * 握り潰しも自動リトライもしない（§7。docs/principles/fail-fast.md）。
 */
function formatAjvErrors(toolName: string, errors: ErrorObject[] | null | undefined): string {
  const detail = (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
  return `"${toolName}" の入力が JSON Schema を満たさない: ${detail}`;
}

/**
 * JSON Schema 検証失敗・未知ツールはプロトコルレベルのエラーとして応答する
 * （JSON-RPC error response。-32602 / -32601）。v2 では McpError が廃止され、
 * ハンドラが投げた ProtocolError がそのままワイヤのエラーレスポンスになる。
 */
function invalidParams(message: string): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.InvalidParams, message);
}

function methodNotFound(name: string): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.MethodNotFound, `未知のツール: "${name}"`);
}

// 受け取るのは JSON 化済みのツール出力。ツールごとに異なる Output 型をここで
// 引き回さず、直列化は呼び出し側（registerTool）に置いている。
function toCallToolResult(outputJson: string): CallToolResult {
  return { content: [{ type: "text", text: outputJson }] };
}

function toDomainRejectionResult(error: DomainRejection): CallToolResult {
  return { isError: true, content: [{ type: "text", text: error.message }] };
}

/**
 * 1 つのツールを、自分の inputSchema から作った ajv バリデータと組にした
 * 実行単位。Input / Output を型引数として外に出さないのが要点。
 *
 * handle は async である（全ツールが GraphStore.transaction() / read() を経由する。
// §4）。ajv.compile<Input>() が返すのは `data is Input` を宣言した型述語であり、
 * 「ajv の検証を通過した時点で入力は inputSchema の形を満たす」という不変条件を
 * 型システムの中で受け取る。
 */
interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Tool["inputSchema"];
  readonly call: (store: GraphStore, rawArguments: CallToolArguments) => Promise<CallToolResult>;
}

/**
 * 手書き JSON Schema を SDK v2 の Tool.inputSchema 型へ適合させる。
 *
 * ここだけが型アサーションを必要とする箇所である。理由: v2 の inputSchema は
 * JSON Schema の厳格な構造的 union として宣言されており、oneOf / const / enum を
 * 含む手書きリテラルは構造的に合致しない。実行時の正は ajv（同一オブジェクトを
 * compile したもの）であり、ListTools 応答に載せる形への変換だけをこの関数が
 * 責任を持つ。
 */
function toSdkInputSchema(schema: InputSchema): Tool["inputSchema"] {
  // SAFETY: 手書き JSON Schema（InputSchema）の実行時契約は、同一オブジェクトを
  // 渡した ajv.compile()（registerTool 内）がツール呼び出しごとに検証する。ここは
  // ListTools 応答の型を SDK 側の構造的 union に合わせるための表現変換のみで、
  // 実行時の値そのものは変えない。
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- 上のコメント参照。
  return schema as unknown as Tool["inputSchema"];
}

function registerTool<Input, Output>(
  ajv: Ajv,
  tool: ToolDefinition<Input, Output>,
): RegisteredTool {
  const validate = ajv.compile<Input>(tool.inputSchema);

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: toSdkInputSchema(tool.inputSchema),
    call: async (store, rawArguments) => {
      if (!validate(rawArguments)) {
        throw invalidParams(formatAjvErrors(tool.name, validate.errors));
      }
      try {
        return toCallToolResult(JSON.stringify(await tool.handle(store, rawArguments), null, 2));
      } catch (error) {
        // throw は任意の値を投げられるため catch した値は unknown。ドメイン拒否の
        // 判定に unknown をそのまま渡さず、まず Error に絞ってから種別を見る。
        // Error ですらない値はドメイン拒否ではないので、そのまま再送出される。
        if (error instanceof Error && isDomainRejection(error)) {
          return toDomainRejectionResult(error);
        }
        throw error;
      }
    },
  };
}

// 13 ツールは設計正本 §8 の表で固定されており、増やさない。
// ramune_next_node は削除済み（§3。互換エントリも存在しない）。
function registerTools(ajv: Ajv): readonly RegisteredTool[] {
  return [
    registerTool(ajv, readGraphTool),
    registerTool(ajv, startTool),
    registerTool(ajv, claimReadyTool),
    registerTool(ajv, applyOpsTool),
    registerTool(ajv, recordResultTool),
    registerTool(ajv, submitCandidateTool),
    registerTool(ajv, claimIntegrationTool),
    registerTool(ajv, advanceIntegrationTool),
    registerTool(ajv, recordIntegrationOutcomeTool),
    registerTool(ajv, requestReplanTool),
    registerTool(ajv, abandonAssignmentTool),
    registerTool(ajv, resumeTool),
    registerTool(ajv, endTool),
  ];
}

function resolveTool(
  toolsByName: ReadonlyMap<string, RegisteredTool>,
  name: string,
): RegisteredTool {
  const tool = toolsByName.get(name);
  if (tool === undefined) {
    throw methodNotFound(name);
  }
  return tool;
}

export interface CreateRamuneServerOptions {
  readonly store: GraphStore;
}

// 戻り値の型注釈にも非推奨の Server が出る（下の `new Server(...)` のコメント参照）。
// oxlint-disable-next-line typescript/no-deprecated -- 上のコメント参照。
export function createRamuneServer(options: CreateRamuneServerOptions): Server {
  const { store } = options;
  const tools = registerTools(new Ajv({ allErrors: true, strict: true }));
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool] as const));

  // McpServer（高レベル API）は入力スキーマを zod からしか受け取れず、「契約 =
  // JSON Schema そのもの」という ramune の要件（ファイル冒頭のコメント参照）を
  // 満たせないため、非推奨の低レベル Server を意図的に使い続ける。
  // oxlint-disable-next-line typescript/no-deprecated -- 上のコメント参照。
  const server = new Server(
    { name: "ramune-mcp-server", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  // v2 の setRequestHandler は第1引数にメソッド名、ハンドラにデコード済み
  // リクエストを受け取る（tools/list の応答は ListToolsResult 形）。
  server.setRequestHandler("tools/list", () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler("tools/call", async (request): Promise<CallToolResult> => {
    const tool = resolveTool(toolsByName, request.params.name);
    return await tool.call(store, request.params.arguments ?? {});
  });

  return server;
}
