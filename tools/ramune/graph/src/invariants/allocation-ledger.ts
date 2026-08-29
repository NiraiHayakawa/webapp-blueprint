// §2.8-2「nextAllocationId は保存済みの全 allocation ID より大きい」の検査。
// allocator 台帳は明示的なフィールドではなく、グラフ内のあらゆる発番 ID
// （fence・conflict・blockage・生成ノード ID・deps への R 参照）を集めて
// max を取ることで構成する（設計正本 §2.5）。
import type { GraphV2 } from "../graph.ts";
import type { GraphNode } from "../nodes.ts";
import type { IntegrationBlockage } from "../blockage.ts";
import type { InvariantViolation } from "../invariant-violation.ts";
import { isNonNegativeSafeInt } from "./unsafe-numbers.ts";

type IssuedIds = Set<number>;

const GENERATED_NODE_ID_PATTERN = /^gen-\d+$/u;

function addGeneratedNodeId(issued: IssuedIds, value: string): void {
  if (GENERATED_NODE_ID_PATTERN.test(value)) {
    issued.add(Math.trunc(Number(value.slice("gen-".length))));
  }
}

/** 統合段階の blockage が運ぶ ID（blockage 自身・journal の assignment・conflict）。 */
function addIntegrationBlockageIds(issued: IssuedIds, blockage: IntegrationBlockage): void {
  issued.add(blockage.id);
  if (blockage.kind !== "candidate_rejected") {
    issued.add(blockage.integration.assignment.id);
  }
  if (blockage.kind === "integration_conflict") {
    issued.add(blockage.conflict.id);
    addGeneratedNodeId(issued, blockage.resolutionNodeId);
  }
}

function addResolutionIds(
  issued: IssuedIds,
  record: Extract<GraphNode, { readonly kind: "task" }>["resolutions"][number],
): void {
  if (record.previous.phase === "execution") {
    issued.add(record.previous.blockage.id);
    issued.add(record.previous.blockage.assignment.id);
    return;
  }
  addIntegrationBlockageIds(issued, record.previous.blockage);
}

/** 現在の status が保持する live な発番 ID（running / candidate.source / journal）。 */
function addLiveStatusIds(
  issued: IssuedIds,
  node: Extract<GraphNode, { readonly kind: "task" }>,
): void {
  if (node.status === "running") {
    issued.add(node.assignment.id);
  }
  const holdingCandidate =
    node.effect === "repository_change" &&
    (node.status === "awaiting_integration" || node.status === "integrating");
  if (holdingCandidate) {
    issued.add(node.candidate.source.id);
  }
  if (node.effect === "repository_change" && node.status === "integrating") {
    issued.add(node.integration.assignment.id);
  }
}

function addBlockedIds(
  issued: IssuedIds,
  node: Extract<GraphNode, { readonly kind: "task" }>,
): void {
  if (node.effect !== "repository_change" || node.status !== "blocked") {
    return;
  }
  if (node.phase === "execution") {
    issued.add(node.blockage.id);
    issued.add(node.blockage.assignment.id);
    return;
  }
  addIntegrationBlockageIds(issued, node.blockage);
}

function addTaskIssuedIds(
  issued: IssuedIds,
  node: Extract<GraphNode, { readonly kind: "task" }>,
): void {
  // 解消チェーンで C の deps に追加された R の ID も発番の証跡である
  for (const dep of node.deps) {
    addGeneratedNodeId(issued, dep);
  }
  for (const record of node.resolutions) {
    addResolutionIds(issued, record);
  }
  addLiveStatusIds(issued, node);
  addBlockedIds(issued, node);
}

/** allocator が発番したことがある全 ID（fence・conflict・blockage・生成ノード ID）。 */
function collectIssuedAllocationIds(graph: GraphV2): readonly number[] {
  const issued = new Set<number>();
  for (const node of graph.nodes) {
    addGeneratedNodeId(issued, node.id);
    if (node.kind === "task") {
      addTaskIssuedIds(issued, node);
    }
  }
  return [...issued];
}

export function findAllocatorViolations(graph: GraphV2): readonly InvariantViolation[] {
  let maxIssued = -1;
  for (const id of collectIssuedAllocationIds(graph)) {
    if (!isNonNegativeSafeInt(id)) {
      return [
        {
          kind: "unsafe_number",
          field: "allocationId",
          value: id,
          detail: "allocator が発番した ID が非負の safe integer の範囲外",
        },
      ];
    }
    maxIssued = Math.max(maxIssued, id);
  }
  if (maxIssued >= graph.nextAllocationId) {
    return [
      {
        kind: "allocator_behind_issued",
        nextAllocationId: graph.nextAllocationId,
        maxIssuedId: maxIssued,
      },
    ];
  }
  return [];
}
