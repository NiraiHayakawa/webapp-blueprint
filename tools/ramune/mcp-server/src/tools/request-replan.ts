// ramune_request_replan: Worker / Integrator が「詰まった」ことをグラフに記録する
// （ADR 0002 / §8）。running ノードの Worker は blocked(worker_request)、
// integrating ノードの Integrator は blocked(integration_replan_requested) へ遷移する。
// fence の完全一致で認証する完了系ツール（expected_revision 不要求。§4）。
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import { requestReplan } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";
import { toDomainFence, toDomainNonEmptyString, type FenceInput } from "./wire.ts";

const inputSchema: InputSchema = {
  type: "object",
  properties: {
    fence: {
      type: "object",
      properties: {
        id: { type: "integer", minimum: 0 },
        node_id: { type: "string", minLength: 1 },
        run_id: { type: "string", minLength: 1 },
        epoch: { type: "integer", minimum: 0 },
      },
      required: ["id", "node_id", "run_id", "epoch"],
      additionalProperties: false,
    },
    reason: { type: "string", minLength: 1 },
  },
  required: ["fence", "reason"],
  additionalProperties: false,
};

export interface RequestReplanInput {
  readonly fence: FenceInput;
  readonly reason: string;
}

export const requestReplanTool: ToolDefinition<RequestReplanInput, GraphV2> = {
  name: "ramune_request_replan",
  description:
    "Worker / Integrator が詰まったとき、対象ノードを blocked にして理由を記録する。" +
    "解除は resolution 必須の reopen のみであり、グラフの構造（deps）は変えない",
  inputSchema,
  handle: async (store, input) => {
    const fence = toDomainFence(input.fence);
    return await store.transaction({}, (graph) =>
      requestReplan(graph, {
        type: "request_replan",
        fence,
        reason: toDomainNonEmptyString(input.reason),
      }),
    );
  },
};
