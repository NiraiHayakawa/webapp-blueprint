// 統合対象ノードの解決を advance_integration / record_integration_outcome で共有する
// 前提条件チェック（task-node.ts と同じ「形だけ持ち、throw は委譲する」方式）。
//
// fence の nodeId にある integrating ノードを取り出し、stale fence（§2.2）を検査する。
// boundary ノードは統合対象になり得ないため、not_integrating（status: "boundary"）で
// 拒否する。違反の組み立てと throw は呼び出し元のエラー型へ委譲される。
import { sameFence, type AssignmentFence } from "../assignment.ts";
import type { GraphV2 } from "../graph.ts";
import type { RepositoryNode } from "../nodes.ts";
import { requireTaskNode } from "./task-node.ts";

export type IntegrationTargetViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | { readonly reason: "not_integrating"; readonly nodeId: string; readonly status: string }
  | { readonly reason: "stale_fence"; readonly nodeId: string };

export type IntegratingNode = Extract<RepositoryNode, { readonly status: "integrating" }>;

export function requireIntegratingTarget(
  graph: GraphV2,
  fence: AssignmentFence,
  throwViolation: (violation: IntegrationTargetViolation) => never,
): IntegratingNode {
  const task = requireTaskNode(graph, fence.nodeId, (violation) =>
    violation.reason === "node_not_found"
      ? throwViolation({ reason: "node_not_found", nodeId: fence.nodeId })
      : throwViolation({ reason: "not_integrating", nodeId: fence.nodeId, status: "boundary" }),
  );
  if (task.status !== "integrating") {
    return throwViolation({ reason: "not_integrating", nodeId: fence.nodeId, status: task.status });
  }
  if (!sameFence(task.integration.assignment, fence)) {
    return throwViolation({ reason: "stale_fence", nodeId: fence.nodeId });
  }
  return task;
}
