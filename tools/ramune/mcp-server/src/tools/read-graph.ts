// ramune_read_graph: .ramune/graph.json の全体を返す。入力を取らない。
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";

const inputSchema: InputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export type ReadGraphInput = Record<string, never>;

export const readGraphTool: ToolDefinition<ReadGraphInput, GraphV2> = {
  name: "ramune_read_graph",
  description: ".ramune/graph.json に外在化されたグラフ全体を返す",
  inputSchema,
  handle: async (store) => await store.read(),
};
