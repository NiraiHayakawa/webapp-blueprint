// ramune_submit_candidate: repository_change ノードを running → awaiting_integration
// にする（§6.1 / §8）。Worker 専用。
//
// fence の完全一致で認証する完了系ツール（expected_revision 不要求。§4）。
// candidate の source は Worker の申告ではなく、サーバーがノードに保持された
// current assignment からコピーする（Worker は baseCommit / workspaceId を
// 入力として受け取らない）。
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import { submitCandidate } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";
import {
  nowIso,
  toDomainCommit,
  toDomainFence,
  toDomainReport,
  type FenceInput,
  type ReportInput,
} from "./wire.ts";

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
    commit: { type: "string", minLength: 1 },
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
  required: ["fence", "commit", "report"],
  additionalProperties: false,
};

export interface SubmitCandidateInput {
  readonly fence: FenceInput;
  readonly commit: string;
  readonly report: ReportInput;
}

export const submitCandidateTool: ToolDefinition<SubmitCandidateInput, GraphV2> = {
  name: "ramune_submit_candidate",
  description:
    "repository_change ノードの candidate commit を提出し、running → awaiting_integration へ遷移させる。" +
    "candidate の source は current assignment からコピーされる",
  inputSchema,
  handle: async (store, input) => {
    const fence = toDomainFence(input.fence);
    return await store.transaction({}, (graph) =>
      submitCandidate(graph, {
        type: "submit_candidate",
        nodeId: fence.nodeId,
        fence,
        commit: toDomainCommit(input.commit),
        report: toDomainReport(input.report),
        submittedAt: nowIso(),
      }),
    );
  },
};
