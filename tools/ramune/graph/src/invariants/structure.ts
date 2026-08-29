// §2.8-3 のうち構造まわりの検査: ノード ID の一意・boundary の存在と不変形・
// deps の実在性（重複・自己参照・end 依存・サイクル）。
import { END_NODE_ID } from "../nodes.ts";
import type { BoundaryNode } from "../nodes.ts";
import { findCycles, type DepsBearingNode } from "../cycle-detection.ts";
import type { InvariantViolation } from "../invariant-violation.ts";
import type { GraphV2 } from "../graph.ts";

export function findDuplicateNodeIds(graph: GraphV2): readonly InvariantViolation[] {
  const seen = new Set<string>();
  const violations: InvariantViolation[] = [];
  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      violations.push({ kind: "duplicate_node_id", id: node.id });
    } else {
      seen.add(node.id);
    }
  }
  return violations;
}

function boundaryOf(graph: GraphV2, boundary: "start" | "end"): BoundaryNode | undefined {
  return graph.nodes.find(
    (node): node is BoundaryNode => node.kind === "boundary" && node.boundary === boundary,
  );
}

function missingEnd(graph: GraphV2): readonly InvariantViolation[] {
  if (boundaryOf(graph, "end") !== undefined) {
    return [];
  }
  return [{ kind: "missing_boundary_node", boundary: "end" }];
}

export function findBoundaryViolations(graph: GraphV2): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const start = boundaryOf(graph, "start");
  if (!start) {
    violations.push({ kind: "missing_boundary_node", boundary: "start" });
    return [...violations, ...missingEnd(graph)];
  }
  if (start.deps.length > 0) {
    violations.push({
      kind: "boundary_mutated",
      boundary: "start",
      detail: `start の deps は常に空でなければならない（実際: [${start.deps.join(", ")}]）`,
    });
  }
  return [...violations, ...missingEnd(graph)];
}

/** 1 ノードの deps 行検査の文脈（全ノード ID の集合と、行内で既に見た dep）。 */
interface DependencyCheckContext {
  readonly ids: ReadonlySet<string>;
  readonly seen: ReadonlySet<string>;
}

/** 1 件の dep に対する検査（実在・自己参照・重複・end 依存）。 */
function dependencyViolationsForDep(
  node: DepsBearingNode,
  depId: string,
  ctx: DependencyCheckContext,
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  if (!ctx.ids.has(depId)) {
    violations.push({ kind: "dangling_dependency", nodeId: node.id, missingDepId: depId });
  }
  if (depId === node.id) {
    violations.push({ kind: "self_dependency", nodeId: node.id });
  }
  if (ctx.seen.has(depId)) {
    violations.push({ kind: "duplicate_dependency", nodeId: node.id, depId });
  }
  if (depId === END_NODE_ID) {
    violations.push({ kind: "end_dependency", nodeId: node.id });
  }
  return violations;
}

/** 1 ノードの deps 行検査（実在・自己参照・重複・end 依存）。 */
function dependencyViolationsForNode(
  node: DepsBearingNode,
  ids: ReadonlySet<string>,
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const seen = new Set<string>();
  for (const depId of node.deps) {
    violations.push(...dependencyViolationsForDep(node, depId, { ids, seen }));
    seen.add(depId);
  }
  return violations;
}

export function findDependencyViolations(graph: GraphV2): readonly InvariantViolation[] {
  const ids = new Set<string>(graph.nodes.map((node) => node.id));
  const violations: InvariantViolation[] = [];
  // SAFETY: GraphV2 の全ノード（BoundaryNode | ReadOnlyNode | RepositoryNode）は
  // いずれも deps: readonly string[] 相当のフィールドを持つため、DepsBearingNode
  // として扱うのは構造的に安全
  for (const node of graph.nodes as readonly DepsBearingNode[]) {
    violations.push(...dependencyViolationsForNode(node, ids));
  }
  return [...violations, ...findCycles(graph.nodes)];
}
