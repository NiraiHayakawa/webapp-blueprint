// ramune_advance_integration: journal を claimed → merge_prepared → publish_prepared
// へ前進させる（§6.2 / §8）。Integrator 専用。fence の完全一致で認証する完了系
// ツール（expected_revision 不要求。§4）。
//
// publish_prepared は canonical への CAS より先に永続化される（crash 後の照合 §7）。
// 前進には統合結果に対する 1 コマンド検証（mise run check。絶対規約 8）の成功証跡を
// 必須とする。証跡の finished_at は Integrator（検証を実行した側）が提示する。
import { advanceIntegration, isoDateTimeSchema } from "@webapp-blueprint/ramune-graph";
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";
import { toDomainCommit, toDomainDigest, toDomainFence, type FenceInput } from "./wire.ts";

const verificationSchema = {
  type: "object",
  properties: {
    checked_commit: { type: "string", minLength: 1 },
    output_digest: { type: "string", minLength: 1 },
    finished_at: { type: "string", minLength: 1 },
  },
  required: ["checked_commit", "output_digest", "finished_at"],
  additionalProperties: false,
} as const;

const progressSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        stage: { const: "merge_prepared" },
        integrated_commit: { type: "string", minLength: 1 },
      },
      required: ["stage", "integrated_commit"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        stage: { const: "publish_prepared" },
        integrated_commit: { type: "string", minLength: 1 },
        verification: verificationSchema,
      },
      required: ["stage", "integrated_commit", "verification"],
      additionalProperties: false,
    },
  ],
};

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
    progress: progressSchema,
  },
  required: ["fence", "progress"],
  additionalProperties: false,
};

interface MergePreparedInput {
  readonly stage: "merge_prepared";
  readonly integrated_commit: string;
}

interface PublishPreparedInput {
  readonly stage: "publish_prepared";
  readonly integrated_commit: string;
  readonly verification: {
    readonly checked_commit: string;
    readonly output_digest: string;
    readonly finished_at: string;
  };
}

type AdvanceProgressInput = MergePreparedInput | PublishPreparedInput;

export interface AdvanceIntegrationInput {
  readonly fence: FenceInput;
  readonly progress: AdvanceProgressInput;
}

export const advanceIntegrationTool: ToolDefinition<AdvanceIntegrationInput, GraphV2> = {
  name: "ramune_advance_integration",
  description:
    "journal を claimed → merge_prepared → publish_prepared の順に前進させる。" +
    "publish_prepared への前進には mise run check の成功証跡が必須",
  inputSchema,
  handle: async (store, input) => {
    const fence = toDomainFence(input.fence);
    return await store.transaction({}, (graph) =>
      advanceIntegration(graph, {
        type: "advance_integration",
        fence,
        progress:
          input.progress.stage === "publish_prepared"
            ? {
                stage: "publish_prepared",
                integratedCommit: toDomainCommit(input.progress.integrated_commit),
                verification: {
                  checkedCommit: toDomainCommit(input.progress.verification.checked_commit),
                  outputDigest: toDomainDigest(input.progress.verification.output_digest),
                  finishedAt: isoDateTimeSchema.parse(input.progress.verification.finished_at),
                },
              }
            : {
                stage: "merge_prepared",
                integratedCommit: toDomainCommit(input.progress.integrated_commit),
              },
      }),
    );
  },
};
