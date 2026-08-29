// §2.8-5「graph 全体で integrating は高々 1 件」と §2.8-6「Candidate.source は
// submit 時の current assignment と完全一致（グラフ層では source.nodeId === ノード id
// まで）」の検査。commit の子孫検査は Git 観観測が必要でありサーバ側（WP3 / WP6）責務。
import type { GraphV2 } from "../graph.ts";
import type { RepositoryNode } from "../nodes.ts";
import type { CandidateHoldingNode } from "../narrowing.ts";
import type { InvariantViolation } from "../invariant-violation.ts";

function repositoryTaskNodes(graph: GraphV2): readonly RepositoryNode[] {
  return graph.nodes.filter(
    (node): node is RepositoryNode => node.kind === "task" && node.effect === "repository_change",
  );
}

export function findIntegratingViolations(graph: GraphV2): readonly InvariantViolation[] {
  const integrating = repositoryTaskNodes(graph)
    .filter((node) => node.status === "integrating")
    .map((node) => node.id);
  return integrating.length > 1 ? [{ kind: "multiple_integrating", nodeIds: integrating }] : [];
}

/** candidate を保持している状態（awaiting / integrating / 統合段階 blocked / done）。 */
function candidateHoldingNodes(graph: GraphV2): readonly CandidateHoldingNode[] {
  const out: CandidateHoldingNode[] = [];
  for (const node of repositoryTaskNodes(graph)) {
    if (
      node.status === "awaiting_integration" ||
      node.status === "integrating" ||
      node.status === "done" ||
      (node.status === "blocked" && node.phase === "integration")
    ) {
      out.push(node);
    }
  }
  return out;
}

export function findCandidateSourceViolations(graph: GraphV2): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const node of candidateHoldingNodes(graph)) {
    if (node.candidate.source.nodeId !== node.id) {
      violations.push({
        kind: "candidate_source_node_mismatch",
        nodeId: node.id,
        sourceNodeId: node.candidate.source.nodeId,
      });
    }
  }
  return violations;
}
