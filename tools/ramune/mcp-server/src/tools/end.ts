// ramune_end: ramune モードを非稼働状態にする。グラフ自体(.ramune/graph.json)は
// 削除・変更しない。Orchestrator 専用（権限の機械強制は @webapp-blueprint/ramune-hooks が
// 担う。ADR 0003「ramune モードの状態機構」）。
//
// running / awaiting_integration / integrating のノードが 1 件でもある場合は、
// ドメイン層（endSession）が unfinished_nodes_exist で拒否する（§8）。
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import { endSession } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";

const inputSchema: InputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const endTool: ToolDefinition<Record<string, never>, GraphV2> = {
  name: "ramune_end",
  description:
    "ramune モードを非稼働にする。実行中ノード（running / awaiting_integration / integrating）" +
    "が存在する場合は拒否される",
  inputSchema,
  handle: async (store) =>
    await store.transaction({}, (graph) => endSession(graph, { type: "end_session" })),
};
