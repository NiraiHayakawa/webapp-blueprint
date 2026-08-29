// §2.8-4「active な assignment の fence は graph の session.runId / epoch と完全一致」。
import type { GraphV2 } from "../graph.ts";
import type { AssignmentFence } from "../assignment.ts";
import type { GraphNode } from "../nodes.ts";
import type { InvariantViolation } from "../invariant-violation.ts";

/**
 * 「live assignment」（書き込み権を持つ claim。running ノードの assignment と、
 * integrating ノードの journal.assignment）だけを session と突き合わせる。
 * candidate.source や blockage 内の fence は履歴の記録であり、resume 後も古い
 * epoch のまま残るため検査対象にしない。
 */
function liveAssignmentOf(node: GraphNode): AssignmentFence | undefined {
  if (node.kind !== "task") {
    return undefined;
  }
  if (node.status === "running") {
    return node.assignment;
  }
  if (node.effect === "repository_change" && node.status === "integrating") {
    return node.integration.assignment;
  }
  return undefined;
}

function isLiveFenceMismatch(
  nodeId: string,
  assignment: AssignmentFence,
  session: { readonly runId: string; readonly epoch: number },
): boolean {
  return (
    assignment.runId !== session.runId ||
    assignment.epoch !== session.epoch ||
    assignment.nodeId !== nodeId
  );
}

function fenceViolationFor(
  nodeId: string,
  liveAssignment: AssignmentFence,
  session: GraphV2["session"],
): InvariantViolation | undefined {
  if (session.state !== "active") {
    return {
      kind: "fence_session_mismatch",
      nodeId,
      detail: `非稼働セッションで live assignment が残っている（assignmentId=${liveAssignment.id}）`,
    };
  }
  if (!isLiveFenceMismatch(nodeId, liveAssignment, session)) {
    return undefined;
  }
  return {
    kind: "fence_session_mismatch",
    nodeId,
    detail: `live fence（runId=${liveAssignment.runId}, epoch=${liveAssignment.epoch}, nodeId=${liveAssignment.nodeId}）が session（runId=${session.runId}, epoch=${session.epoch}）と不一致`,
  };
}

export function findFenceSessionViolations(graph: GraphV2): readonly InvariantViolation[] {
  const { session } = graph;
  const violations: InvariantViolation[] = [];
  for (const node of graph.nodes) {
    const liveAssignment = liveAssignmentOf(node);
    if (liveAssignment === undefined) {
      continue;
    }
    const violation = fenceViolationFor(node.id, liveAssignment, session);
    if (violation !== undefined) {
      violations.push(violation);
    }
  }
  return violations;
}
