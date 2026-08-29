// ramune_record_result: read_only ノードを running → done にする（§8）。
// Worker 専用（権限の機械強制は @webapp-blueprint/ramune-hooks が担う）。
//
// fence の完全一致（{ nodeId, runId, epoch, assignmentId }）で認証する完了系
// ツールであり、expected_revision は要求しない（§4 の粒度分け）。stale fence
// （旧 epoch / 旧 runId / assignmentId 不一致）の書き込みはドメイン層が拒否する。
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import { recordResult } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";
import { toDomainFence, toDomainReport, type FenceInput, type ReportInput } from "./wire.ts";

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
    report: {
      type: "object",
      properties: {
        summary: { type: "string", minLength: 1 },
        data: {},
      },
      required: ["summary", "data"],
      additionalProperties: false,
    },
  },
  required: ["fence", "report"],
  additionalProperties: false,
};

export interface RecordResultInput {
  readonly fence: FenceInput;
  readonly report: ReportInput;
}

export const recordResultTool: ToolDefinition<RecordResultInput, GraphV2> = {
  name: "ramune_record_result",
  description:
    "read_only ノードの作業報告を受け取り、running → done へ遷移させる。" +
    "fence による完全一致認証が必要",
  inputSchema,
  handle: async (store, input) => {
    const fence = toDomainFence(input.fence);
    return await store.transaction({}, (graph) =>
      recordResult(graph, {
        type: "record_result",
        nodeId: fence.nodeId,
        fence,
        report: toDomainReport(input.report),
      }),
    );
  },
};
