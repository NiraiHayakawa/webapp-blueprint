// ramune_abandon_assignment: 死んだ Worker / Integrator の claim を回収する
// （§7）。Orchestrator が終了を確認した後に呼ぶ。fence の完全一致を要求する
// 判断系の回復操作であり、旧 Orchestrator の遅延した死亡確認が新 assignment を
// 潰すことはない。
//
// - 実行段階（running ノード）: blocked(worker_terminated)。observed_git は渡せない
// - 統合段階（integrating ノード）: observed_git が必須。journal と観測の照合で
//   publish 済み → done / canonical clean → awaiting_integration へ復帰 /
//   確定不能 → blocked(integration_state_uncertain)（fail-closed）
import type { AbandonAssignmentOperation, GraphV2 } from "@webapp-blueprint/ramune-graph";
import { abandonAssignment } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";
import {
  toDomainFence,
  toDomainGitObservation,
  toDomainNonEmptyString,
  type FenceInput,
  type GitObservationInput,
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
    evidence: { type: "string", minLength: 1 },
    observed_git: {
      type: "object",
      properties: {
        canonical_head: { type: "string", minLength: 1 },
        canonical_worktree: { enum: ["clean", "dirty", "merge_in_progress", "missing"] },
        integration_workspace: { enum: ["clean", "dirty", "merge_in_progress", "missing"] },
      },
      required: ["canonical_head", "canonical_worktree", "integration_workspace"],
      additionalProperties: false,
    },
  },
  required: ["fence", "evidence"],
  additionalProperties: false,
};

export interface AbandonAssignmentInput {
  readonly fence: FenceInput;
  readonly evidence: string;
  readonly observed_git?: GitObservationInput;
}

export const abandonAssignmentTool: ToolDefinition<AbandonAssignmentInput, GraphV2> = {
  name: "ramune_abandon_assignment",
  description:
    "死亡した Worker / Integrator の claim を回収する。統合段階の死亡確認では" +
    "observed_git が必須であり、journal との照合で状態を決定的に確定できる場合だけ遷移する" +
    "（確定できなければ integration_state_uncertain）",
  inputSchema,
  handle: async (store, input) => {
    const fence = toDomainFence(input.fence);
    const operation: AbandonAssignmentOperation = {
      type: "abandon_assignment",
      fence,
      evidence: toDomainNonEmptyString(input.evidence),
    };
    const { observed_git: observedGitInput } = input;
    if (observedGitInput !== undefined) {
      return await store.transaction({}, (graph) =>
        abandonAssignment(graph, {
          ...operation,
          observedGit: toDomainGitObservation(observedGitInput),
        }),
      );
    }
    return await store.transaction({}, (graph) => abandonAssignment(graph, operation));
  },
};
