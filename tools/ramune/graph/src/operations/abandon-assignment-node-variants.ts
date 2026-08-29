// abandon_assignment が組み立てるノードの遷移先バリアント。operation 本体
// （abandon-assignment.ts）から分離（max-lines 対応。挙動変更なし）。
import type { GraphV2 } from "../graph.ts";
import type { GeneratedNodeId, PlannedNodeId } from "../brand.ts";
import type { ConflictDescriptor, ExecutionBlockage, IntegrationBlockage } from "../blockage.ts";
import type { GraphNode, ReadOnlyNode, RepositoryNode } from "../nodes.ts";

export type RunningReadOnlyNode = Extract<ReadOnlyNode, { readonly status: "running" }>;
export type RunningRepositoryNode = Extract<RepositoryNode, { readonly status: "running" }>;
export type IntegratingTaskNode = Extract<RepositoryNode, { readonly status: "integrating" }>;
export type BlockedReadOnlyNode = Extract<ReadOnlyNode, { readonly status: "blocked" }>;
export type BlockedRepositoryNode = Extract<RepositoryNode, { readonly status: "blocked" }>;
export type IntegrationBlockedNode = Extract<
  RepositoryNode,
  { readonly status: "blocked"; readonly phase: "integration" }
>;
export type AwaitingRepositoryNode = Extract<
  RepositoryNode,
  { readonly status: "awaiting_integration" }
>;
type RunningOrIntegratingRepository =
  | Extract<RepositoryNode, { readonly status: "running" }>
  | IntegratingTaskNode;

export function replace(
  graph: GraphV2,
  nodeId: string,
  replacement: GraphNode,
): readonly GraphNode[] {
  return graph.nodes.map((node) => (node.id === nodeId ? replacement : node));
}

function originOf(node: RunningOrIntegratingRepository):
  | { readonly purpose: "planned" }
  | {
      readonly purpose: "conflict_resolution";
      readonly resolves: GeneratedNodeId | PlannedNodeId;
      readonly conflict: ConflictDescriptor;
    } {
  return node.purpose === "conflict_resolution"
    ? { purpose: node.purpose, resolves: node.resolves, conflict: node.conflict }
    : { purpose: node.purpose };
}

export function executionBlockedVariant(
  target: RunningReadOnlyNode,
  blockage: ExecutionBlockage,
): BlockedReadOnlyNode {
  return {
    kind: "task",
    id: target.id,
    title: target.title,
    deps: target.deps,
    resolutions: target.resolutions,
    purpose: "planned",
    effect: "read_only",
    status: "blocked",
    phase: "execution",
    blockage,
  };
}

/** running の repository_change ノードを実行段階 blocked（worker_terminated）へ。 */
export function executionBlockedRepositoryVariant(
  target: RunningRepositoryNode,
  blockage: ExecutionBlockage & { readonly kind: "worker_terminated" },
): Extract<BlockedRepositoryNode, { readonly phase: "execution" }> {
  return {
    kind: "task",
    id: target.id,
    title: target.title,
    deps: target.deps,
    resolutions: target.resolutions,
    ...originOf(target),
    effect: "repository_change",
    status: "blocked",
    phase: "execution",
    blockage,
  };
}

export function integrationBlockedVariant(
  target: IntegratingTaskNode,
  blockage: IntegrationBlockage,
): IntegrationBlockedNode {
  return {
    kind: "task",
    id: target.id,
    title: target.title,
    deps: target.deps,
    resolutions: target.resolutions,
    ...originOf(target),
    effect: "repository_change",
    status: "blocked",
    phase: "integration",
    candidate: target.candidate,
    blockage,
  };
}

export function awaitingVariant(target: IntegratingTaskNode): AwaitingRepositoryNode {
  return {
    kind: "task",
    id: target.id,
    title: target.title,
    deps: target.deps,
    resolutions: target.resolutions,
    ...originOf(target),
    effect: "repository_change",
    status: "awaiting_integration",
    candidate: target.candidate,
  };
}
