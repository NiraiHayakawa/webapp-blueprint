// ramune_claim_ready: ready ノードの選択と pending → running 遷移を同一 transaction
// で行う（ramune_next_node を置き換える。§3 / §8）。Orchestrator 専用。
//
// - 判断系ツールであるため expected_revision を要求する（§4）
// - ready ノードは宣言順で決定的に選ばれ、limit 件を先頭から取る
// - repository_change ノードには workspaceId をサーバーが発番し、base_commit
//   （Orchestrator が提示する canonical HEAD）とともに assignment へ記録する。
//   実際の git worktree add は WP5 / WP6 の配線に委ねており、このレイヤは
//   グラフ上の割当までを行う。プールの必要数は selectReadyNodes で選択を
//  先回りして数えることで過不足なく揃える（余分は graph 層が拒否する）
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import { randomUUID } from "node:crypto";
import {
  claimReady,
  commitIdSchema,
  revisionSchema,
  selectReadyNodes,
  workspaceIdSchema,
  type ClaimReadyResult,
} from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";
import { nowIso } from "./wire.ts";

function mintWorkspaceId() {
  // workspace の実体（git worktree）は WP6 が生成する。このレイヤでは
  // グラフ上の割当として一意な識別子だけを発番する
  return workspaceIdSchema.parse(`ws-${randomUUID()}`);
}

const inputSchema: InputSchema = {
  type: "object",
  properties: {
    expected_revision: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1 },
    base_commit: { type: "string", minLength: 1 },
  },
  required: ["expected_revision", "limit", "base_commit"],
  additionalProperties: false,
};

export interface ClaimReadyInput {
  readonly expected_revision: number;
  readonly limit: number;
  readonly base_commit: string;
}

export const claimReadyTool: ToolDefinition<ClaimReadyInput, ClaimReadyResult> = {
  name: "ramune_claim_ready",
  description:
    "ready ノード（pending かつ全 deps done）を宣言順で最大 limit 件選び、" +
    "pending → running への遷移と fence の発番を同一トランザクションで行う。" +
    "repository_change ノードには隔離 worktree の識別子（workspaceId）と base_commit を記録する",
  inputSchema,
  handle: async (store, input) => {
    let claimedResult: ClaimReadyResult | undefined;
    const graph = await store.transaction(
      { expectedRevision: revisionSchema.parse(input.expected_revision) },
      (current) => {
        const candidates = selectReadyNodes(current, input.limit);
        const repositoryNodeCount = candidates.filter(
          (candidate) => candidate.effect === "repository_change",
        ).length;
        claimedResult = claimReady(current, {
          type: "claim_ready",
          limit: input.limit,
          startedAt: nowIso(),
          workspaces: Array.from({ length: repositoryNodeCount }, () => ({
            workspaceId: mintWorkspaceId(),
            baseCommit: commitIdSchema.parse(input.base_commit),
          })),
        });
        return claimedResult.graph;
      },
    );
    if (!claimedResult) {
      throw new Error("claim_ready の結果が失われた（実装バグ）");
    }
    return { graph, assignments: claimedResult.assignments };
  },
};
