// ramune_record_integration_outcome: 統合の結果を 1 ツールで受ける（§6.2 / §6.3 / §8）。
// Integrator 専用。fence の完全一致で認証する完了系ツール。
//
// outcome は次の判別可能 union:
//   - success: publish_prepared の journal を完了証跡に変換し、解消 chain 全体を
//     同時に done にする
//   - conflict: 衝突ノード C を blocked(integration_conflict) にして解消ノード R を
//     機械挿入する（ADR 0012）。cleanup 証跡 canonical_after_cleanup が必須
//   - verification_failed: 検証失敗の証跡と Git 観測を blockage へ保持する
//   - candidate_rejected: candidate 内容不備。code と evidence_digest が必須
//   - integration_state_uncertain: 状態を確定できない場合の fail-closed
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import { recordIntegrationOutcome } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";
import {
  toDomainCommit,
  toDomainDigest,
  toDomainFence,
  toDomainFailedCheck,
  toDomainGitObservation,
  toDomainNonEmptyString,
  toDomainRepoPaths,
  type FenceInput,
} from "./wire.ts";

const gitObservationInputSchema = {
  type: "object",
  properties: {
    canonical_head: { type: "string", minLength: 1 },
    canonical_worktree: { enum: ["clean", "dirty", "merge_in_progress", "missing"] },
    integration_workspace: { enum: ["clean", "dirty", "merge_in_progress", "missing"] },
  },
  required: ["canonical_head", "canonical_worktree", "integration_workspace"],
  additionalProperties: false,
} as const;

const fenceInputSchema = {
  type: "object",
  properties: {
    id: { type: "integer", minimum: 0 },
    node_id: { type: "string", minLength: 1 },
    run_id: { type: "string", minLength: 1 },
    epoch: { type: "integer", minimum: 0 },
  },
  required: ["id", "node_id", "run_id", "epoch"],
  additionalProperties: false,
} as const;

const outcomeSchema = {
  oneOf: [
    {
      type: "object",
      properties: { kind: { const: "success" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "conflict" },
        reason: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        files: { type: "array", items: { type: "string", minLength: 1 } },
        canonical_head_at_conflict: { type: "string", minLength: 1 },
        canonical_after_cleanup: {
          type: "object",
          properties: { head: { type: "string", minLength: 1 } },
          required: ["head"],
          additionalProperties: false,
        },
      },
      required: [
        "kind",
        "reason",
        "title",
        "files",
        "canonical_head_at_conflict",
        "canonical_after_cleanup",
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "verification_failed" },
        reason: { type: "string", minLength: 1 },
        failure: {
          type: "object",
          properties: {
            checked_commit: { type: "string", minLength: 1 },
            exit_code: { type: "integer", minimum: 1 },
            output_digest: { type: "string", minLength: 1 },
            finished_at: { type: "string", minLength: 1 },
          },
          required: ["checked_commit", "exit_code", "output_digest", "finished_at"],
          additionalProperties: false,
        },
        observed_git: gitObservationInputSchema,
      },
      required: ["kind", "reason", "failure", "observed_git"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "candidate_rejected" },
        reason: { type: "string", minLength: 1 },
        code: { type: "string", minLength: 1 },
        evidence_digest: { type: "string", minLength: 1 },
      },
      required: ["kind", "reason", "code", "evidence_digest"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "integration_state_uncertain" },
        reason: { type: "string", minLength: 1 },
        observed_git: gitObservationInputSchema,
      },
      required: ["kind", "reason", "observed_git"],
      additionalProperties: false,
    },
  ],
};

const inputSchema: InputSchema = {
  type: "object",
  properties: {
    fence: fenceInputSchema,
    outcome: outcomeSchema,
  },
  required: ["fence", "outcome"],
  additionalProperties: false,
};

type OutcomeInput =
  | { readonly kind: "success" }
  | {
      readonly kind: "conflict";
      readonly reason: string;
      readonly title: string;
      readonly files: readonly string[];
      readonly canonical_head_at_conflict: string;
      readonly canonical_after_cleanup: { readonly head: string };
    }
  | {
      readonly kind: "verification_failed";
      readonly reason: string;
      readonly failure: {
        readonly checked_commit: string;
        readonly exit_code: number;
        readonly output_digest: string;
        readonly finished_at: string;
      };
      readonly observed_git: Parameters<typeof toDomainGitObservation>[0];
    }
  | {
      readonly kind: "candidate_rejected";
      readonly reason: string;
      readonly code: string;
      readonly evidence_digest: string;
    }
  | {
      readonly kind: "integration_state_uncertain";
      readonly reason: string;
      readonly observed_git: Parameters<typeof toDomainGitObservation>[0];
    };

export interface RecordIntegrationOutcomeInput {
  readonly fence: FenceInput;
  readonly outcome: OutcomeInput;
}

type DomainOutcome = Parameters<typeof recordIntegrationOutcome>[1]["outcome"];

function toDomainConflictOutcome(
  outcome: Extract<OutcomeInput, { readonly kind: "conflict" }>,
): DomainOutcome {
  return {
    kind: "conflict",
    reason: toDomainNonEmptyString(outcome.reason),
    title: toDomainNonEmptyString(outcome.title),
    files: toDomainRepoPaths(outcome.files),
    canonicalHeadAtConflict: toDomainCommit(outcome.canonical_head_at_conflict),
    canonicalAfterCleanup: {
      head: toDomainCommit(outcome.canonical_after_cleanup.head),
      worktree: "clean",
    },
  };
}

function toDomainOutcome(outcome: OutcomeInput): DomainOutcome {
  switch (outcome.kind) {
    case "success": {
      return { kind: "success" };
    }
    case "conflict": {
      return toDomainConflictOutcome(outcome);
    }
    case "verification_failed": {
      return {
        kind: "verification_failed",
        reason: toDomainNonEmptyString(outcome.reason),
        failure: toDomainFailedCheck(outcome.failure),
        observedGit: toDomainGitObservation(outcome.observed_git),
      };
    }
    case "candidate_rejected": {
      return {
        kind: "candidate_rejected",
        reason: toDomainNonEmptyString(outcome.reason),
        code: toDomainNonEmptyString(outcome.code),
        evidenceDigest: toDomainDigest(outcome.evidence_digest),
      };
    }
    case "integration_state_uncertain": {
      return {
        kind: "integration_state_uncertain",
        reason: toDomainNonEmptyString(outcome.reason),
        observedGit: toDomainGitObservation(outcome.observed_git),
      };
    }
    default: {
      // 網羅性チェック: outcome の種別が増えたのにここが更新されていない場合、
      // ここで型検査が落ちる
      const exhaustive: never = outcome;
      throw new Error(`unknown outcome kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export const recordIntegrationOutcomeTool: ToolDefinition<RecordIntegrationOutcomeInput, GraphV2> =
  {
    name: "ramune_record_integration_outcome",
    description:
      "統合の結果を記録する。success（publish 済みの確定と解消 chain の同時 done）/" +
      "conflict（衝突ノードの blocked 化と解消ノードの機械挿入）/" +
      "verification_failed / candidate_rejected / integration_state_uncertain",
    inputSchema,
    handle: async (store, input) => {
      const fence = toDomainFence(input.fence);
      return await store.transaction({}, (graph) =>
        recordIntegrationOutcome(graph, {
          type: "record_integration_outcome",
          fence,
          outcome: toDomainOutcome(input.outcome),
        }),
      );
    },
  };
