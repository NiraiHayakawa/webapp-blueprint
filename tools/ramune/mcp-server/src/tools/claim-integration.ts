// ramune_claim_integration: 統合可能な candidate を 1 件 awaiting_integration →
// integrating にし、journal（claimed）を書く（§6.2 / §8）。Orchestrator 専用。
//
// 判断系ツールであるため expected_revision を要求する（§4）。
// canonical_head_before は Orchestrator が観測した canonical HEAD であり、
// publish の expected HEAD 検査（§6.4）と crash 後の照合（§7）の基準になる。
// 統合用 worktree の識別子（workspaceId）はサーバーが発番する。実際の worktree
// 生成は WP5 / WP6 の配線に委ねる。
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import { randomUUID } from "node:crypto";
import {
  claimIntegration,
  commitIdSchema,
  revisionSchema,
  workspaceIdSchema,
  type ClaimIntegrationResult,
} from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";
import { nowIso } from "./wire.ts";

const inputSchema: InputSchema = {
  type: "object",
  properties: {
    expected_revision: { type: "integer", minimum: 0 },
    canonical_head_before: { type: "string", minLength: 1 },
  },
  required: ["expected_revision", "canonical_head_before"],
  additionalProperties: false,
};

export interface ClaimIntegrationInput {
  readonly expected_revision: number;
  readonly canonical_head_before: string;
}

export const claimIntegrationTool: ToolDefinition<ClaimIntegrationInput, ClaimIntegrationResult> = {
  name: "ramune_claim_integration",
  description:
    "awaiting_integration かつ全 deps done の candidate を宣言順で 1 件だけ" +
    "integrating へ遷移させ、journal（claimed）を書く。graph 全体で integrating は高々 1 件",
  inputSchema,
  handle: async (store, input) => {
    let integrationResult: ClaimIntegrationResult | undefined;
    const graph = await store.transaction(
      { expectedRevision: revisionSchema.parse(input.expected_revision) },
      (current) => {
        integrationResult = claimIntegration(current, {
          type: "claim_integration",
          workspaceId: workspaceIdSchema.parse(`ws-${randomUUID()}`),
          startedAt: nowIso(),
          canonicalHeadBefore: commitIdSchema.parse(input.canonical_head_before),
        });
        return integrationResult.graph;
      },
    );
    if (!integrationResult) {
      throw new Error("claim_integration の結果が失われた（実装バグ）");
    }
    return { graph, journal: integrationResult.journal };
  },
};
