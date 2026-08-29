// request_replan: Worker / Integrator が「詰まった」ことをグラフに記録する
// （ramune_request_replan のグラフ層。ADR 0002 / 設計正本 §8）。
//
// - 実行段階（running ノードの Worker）: blocked(worker_request)。fence を証跡として
//   blockage に保持する
// - 統合段階（integrating ノードの Integrator）: blocked(integration_replan_requested)。
//   journal は blockage 内に保持され、candidate も失われない
//
// 構造（deps）は一切変えない。解除は reopen（resolution 必須。ADR 0007）だけである。
import type { GraphV2 } from "../graph.ts";
import { blockageIdSchema, type NonEmptyString } from "../brand.ts";
import { allocateId, finalizeTransaction, nextRevision } from "../transaction.ts";
import { requireTaskNode } from "./task-node.ts";
import { sameFence, type AssignmentFence } from "../assignment.ts";
import type { ExecutionBlockage, IntegrationBlockage } from "../blockage.ts";
import type { GraphNode, ReadOnlyNode, RepositoryNode } from "../nodes.ts";

export interface RequestReplanOperation {
  readonly type: "request_replan";
  readonly fence: AssignmentFence;
  readonly reason: NonEmptyString;
}

export type RequestReplanPreconditionViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | {
      readonly reason: "not_claimed_by_fence";
      readonly nodeId: string;
      readonly status: string;
    }
  | { readonly reason: "stale_fence"; readonly nodeId: string };

export class RequestReplanPreconditionError extends Error {
  readonly violation: RequestReplanPreconditionViolation;

  constructor(violation: RequestReplanPreconditionViolation) {
    super(`request_replan の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "RequestReplanPreconditionError";
    this.violation = violation;
  }
}

function throwRequestReplanPreconditionError(violation: RequestReplanPreconditionViolation): never {
  throw new RequestReplanPreconditionError(violation);
}

type RunningReadOnlyNode = Extract<ReadOnlyNode, { readonly status: "running" }>;
type RunningRepositoryNode = Extract<RepositoryNode, { readonly status: "running" }>;
type IntegratingTaskNode = Extract<RepositoryNode, { readonly status: "integrating" }>;
type BlockedReadOnlyNode = Extract<ReadOnlyNode, { readonly status: "blocked" }>;
type BlockedRepositoryNode = Extract<RepositoryNode, { readonly status: "blocked" }>;

function findTaskTarget(graph: GraphV2, op: RequestReplanOperation): GraphNode {
  return requireTaskNode(graph, op.fence.nodeId, (violation) => {
    if (violation.reason === "node_not_found") {
      return throwRequestReplanPreconditionError({
        reason: "node_not_found",
        nodeId: op.fence.nodeId,
      });
    }
    // boundary ノードは fence の nodeId になり得ないため、fence 不一致として拒否する
    return throwRequestReplanPreconditionError({
      reason: "not_claimed_by_fence",
      nodeId: op.fence.nodeId,
      status: "boundary",
    });
  });
}

function newBlockageId(graph: GraphV2): ReturnType<typeof blockageIdSchema.parse> {
  return blockageIdSchema.parse(allocateId(graph).id);
}

function replace(graph: GraphV2, nodeId: string, replacement: GraphNode): readonly GraphNode[] {
  return graph.nodes.map((node) => (node.id === nodeId ? replacement : node));
}

/** read_only ノードを実行段階の blocked（worker_request）へ。 */
function blockedReadOnlyVariant(
  target: Extract<ReadOnlyNode, { readonly status: "running" }>,
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

/** repository_change ノードを、由来を保ったまま実行段階の blocked（worker_request）へ。 */
function executionBlockedRepositoryVariant(
  target: RunningRepositoryNode,
  blockage: ExecutionBlockage,
): Extract<BlockedRepositoryNode, { readonly phase: "execution" }> {
  const origin =
    target.purpose === "conflict_resolution"
      ? {
          purpose: "conflict_resolution" as const,
          resolves: target.resolves,
          conflict: target.conflict,
        }
      : { purpose: "planned" as const };
  return {
    kind: "task",
    id: target.id,
    title: target.title,
    deps: target.deps,
    resolutions: target.resolutions,
    ...origin,
    effect: "repository_change",
    status: "blocked",
    phase: "execution",
    blockage,
  };
}

/** integrating ノードを、candidate を保持したまま統合段階の blocked へ。 */
function integrationBlockedRepositoryVariant(
  target: IntegratingTaskNode,
  blockage: IntegrationBlockage,
): Extract<BlockedRepositoryNode, { readonly phase: "integration" }> {
  const origin =
    target.purpose === "conflict_resolution"
      ? {
          purpose: "conflict_resolution" as const,
          resolves: target.resolves,
          conflict: target.conflict,
        }
      : { purpose: "planned" as const };
  return {
    kind: "task",
    id: target.id,
    title: target.title,
    deps: target.deps,
    resolutions: target.resolutions,
    ...origin,
    effect: "repository_change",
    status: "blocked",
    phase: "integration",
    candidate: target.candidate,
    blockage,
  };
}

/** 実行段階（running）の Worker からの差し戻し。read_only / repository_change で分岐。 */
function blockRunning(
  graph: GraphV2,
  op: RequestReplanOperation,
  target: RunningReadOnlyNode | RunningRepositoryNode,
): GraphV2 {
  if (!sameFence(target.assignment, op.fence)) {
    return throwRequestReplanPreconditionError({ reason: "stale_fence", nodeId: target.id });
  }
  const blockage: ExecutionBlockage = {
    id: newBlockageId(graph),
    reason: op.reason,
    occurredAtRevision: nextRevision(graph),
    kind: "worker_request",
    assignment: op.fence,
  };
  const nodes = replace(
    graph,
    target.id,
    target.effect === "read_only"
      ? blockedReadOnlyVariant(target, blockage)
      : executionBlockedRepositoryVariant(target, blockage),
  );
  return finalizeTransaction({ ...allocateId(graph).graph, nodes });
}

/** 統合段階（integrating）の Integrator からの差し戻し。candidate / journal を保持。 */
function blockIntegrating(
  graph: GraphV2,
  op: RequestReplanOperation,
  target: IntegratingTaskNode,
): GraphV2 {
  if (!sameFence(target.integration.assignment, op.fence)) {
    return throwRequestReplanPreconditionError({ reason: "stale_fence", nodeId: target.id });
  }
  const allocated = allocateId(graph);
  const blocked = integrationBlockedRepositoryVariant(target, {
    id: blockageIdSchema.parse(allocated.id),
    reason: op.reason,
    occurredAtRevision: nextRevision(graph),
    kind: "integration_replan_requested",
    integration: target.integration,
  });
  return finalizeTransaction({ ...allocated.graph, nodes: replace(graph, target.id, blocked) });
}

type ReplanRoute =
  | { readonly route: "read_only_running"; readonly node: RunningReadOnlyNode }
  | { readonly route: "repo_running"; readonly node: RunningRepositoryNode }
  | { readonly route: "repo_integrating"; readonly node: IntegratingTaskNode };

/** 実行段階（running）の Worker からの経路。 */
function runningReplanRoute(target: GraphNode): ReplanRoute | undefined {
  if (target.kind !== "task" || target.status !== "running") {
    return undefined;
  }
  if (target.effect === "read_only") {
    return { route: "read_only_running", node: target };
  }
  if (target.effect === "repository_change") {
    return { route: "repo_running", node: target };
  }
  return undefined;
}

/** 統合段階（integrating）の Integrator からの経路。 */
function integratingReplanRoute(target: GraphNode): ReplanRoute | undefined {
  if (target.kind !== "task" || target.status !== "integrating") {
    return undefined;
  }
  if (target.effect !== "repository_change") {
    return undefined;
  }
  return { route: "repo_integrating", node: target };
}

/** ノードの状態から差し戻し経路を決める。いずれでもなければ undefined。 */
function replanRouteOf(target: GraphNode): ReplanRoute | undefined {
  return runningReplanRoute(target) ?? integratingReplanRoute(target);
}

function notClaimedByFence(target: GraphNode): never {
  return throwRequestReplanPreconditionError({
    reason: "not_claimed_by_fence",
    nodeId: target.id,
    status: target.kind === "task" ? target.status : target.kind,
  });
}

export function requestReplan(graph: GraphV2, op: RequestReplanOperation): GraphV2 {
  const target = findTaskTarget(graph, op);
  const route = replanRouteOf(target);

  switch (route?.route) {
    case "read_only_running": {
      return blockRunning(graph, op, route.node);
    }
    case "repo_running": {
      return blockRunning(graph, op, route.node);
    }
    case "repo_integrating": {
      return blockIntegrating(graph, op, route.node);
    }
    case undefined: {
      return notClaimedByFence(target);
    }
    default: {
      return notClaimedByFence(target);
    }
  }
}
