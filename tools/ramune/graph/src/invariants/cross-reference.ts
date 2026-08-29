// §2.8-7「C と R の相互参照（resolutionNodeId ↔ resolves）は 1 対 1」の検査。
import type { GraphV2 } from "../graph.ts";
import type { RepositoryNode } from "../nodes.ts";
import type { InvariantViolation } from "../invariant-violation.ts";

interface ConflictDescriptorLike {
  readonly id: number;
  readonly targetNodeId: string;
  readonly targetCandidateCommit: string;
  readonly canonicalHeadAtConflict: string;
  readonly files: readonly string[];
  readonly detectedAtRevision: number;
}

interface CrossRefPair {
  readonly resolverId: string;
  readonly targetId: string;
  readonly conflict: ConflictDescriptorLike;
}

function conflictDescriptorsEqual(a: ConflictDescriptorLike, b: ConflictDescriptorLike): boolean {
  return (
    a.id === b.id &&
    a.targetNodeId === b.targetNodeId &&
    a.targetCandidateCommit === b.targetCandidateCommit &&
    a.canonicalHeadAtConflict === b.canonicalHeadAtConflict &&
    a.detectedAtRevision === b.detectedAtRevision &&
    a.files.length === b.files.length &&
    a.files.every((file, index) => file === b.files[index])
  );
}

function repositoryTaskNodes(graph: GraphV2): readonly RepositoryNode[] {
  return graph.nodes.filter(
    (node): node is RepositoryNode => node.kind === "task" && node.effect === "repository_change",
  );
}

/** 現在 integration_conflict blockage を持つノード（解消待ちの C 側）の一覧。 */
function conflictBlockedPairs(graph: GraphV2): readonly CrossRefPair[] {
  const pairs: CrossRefPair[] = [];
  for (const node of repositoryTaskNodes(graph)) {
    if (node.status !== "blocked" || node.phase !== "integration") {
      continue;
    }
    const { blockage } = node;
    if (blockage.kind !== "integration_conflict") {
      continue;
    }
    pairs.push({
      resolverId: blockage.resolutionNodeId,
      targetId: node.id,
      conflict: blockage.conflict,
    });
  }
  return pairs;
}

/** purpose: conflict_resolution に narrow した R ノード。resolves / conflict を持つ。 */
type ResolutionNode = Extract<RepositoryNode, { readonly purpose: "conflict_resolution" }>;

/** 解消待ちの C 側 blockage と、R が宣言する resolves / conflict の一致。 */
function assertPendingPairMatches(
  pendingPair: CrossRefPair,
  resolverNode: ResolutionNode,
  violations: InvariantViolation[],
): void {
  if (
    pendingPair.targetId === resolverNode.resolves &&
    conflictDescriptorsEqual(pendingPair.conflict, resolverNode.conflict)
  ) {
    return;
  }
  violations.push({
    kind: "cross_reference_broken",
    detail: `${resolverNode.id} の resolves / conflict と ${pendingPair.targetId} 側の blockage が一致しない`,
  });
}

/**
 * 解消済み（C の統合成功で chain が閉じた）場合、C は done になっており blockage
 * は存在しない。完了証跡の conflictId / resolutionNodeId で対応を確認する。
 */
function resolvedThroughDoneResult(resolverNode: ResolutionNode, graph: GraphV2): boolean {
  const target = graph.nodes.find((candidate) => candidate.id === resolverNode.resolves);
  return (
    target?.kind === "task" &&
    target.effect === "repository_change" &&
    target.status === "done" &&
    target.result.kind === "conflict_resolved" &&
    target.result.resolutionNodeId === resolverNode.id &&
    target.result.conflictId === resolverNode.conflict.id
  );
}

/** collectResolverSideViolations / checkOneResolver が共有する検査文脈。 */
interface ResolverCheckContext {
  readonly graph: GraphV2;
  readonly unmatched: Map<string, CrossRefPair>;
  readonly violations: InvariantViolation[];
}

function checkOneResolver(ctx: ResolverCheckContext, node: ResolutionNode): void {
  const pendingPair = ctx.unmatched.get(node.id);
  if (pendingPair !== undefined) {
    assertPendingPairMatches(pendingPair, node, ctx.violations);
    ctx.unmatched.delete(node.id);
    return;
  }
  if (resolvedThroughDoneResult(node, ctx.graph)) {
    return;
  }
  ctx.violations.push({
    kind: "cross_reference_broken",
    detail: `解消ノード ${node.id} は ${node.resolves} を resolves として宣言するが、対応する integration_conflict blockage も解消済みの完了証跡も存在しない`,
  });
}

/** R 側（purpose: conflict_resolution）のノードを検査し、未一致 C の台帳を消化する。 */
function collectResolverSideViolations(ctx: ResolverCheckContext): void {
  for (const node of repositoryTaskNodes(ctx.graph)) {
    if (node.purpose !== "conflict_resolution") {
      continue;
    }
    checkOneResolver(ctx, node);
  }
}

/** 解消待ち C の blockage が指す R が実在しない・purpose が違う場合の違反一覧。 */
function unmatchedPairViolations(
  unmatched: ReadonlyMap<string, CrossRefPair>,
): readonly InvariantViolation[] {
  return [...unmatched.values()].map((pair) => ({
    kind: "cross_reference_broken" as const,
    detail: `${pair.targetId} の blockage は解消ノードとして ${pair.resolverId} を指すが、そのノードは purpose: conflict_resolution の task ではないか存在しない`,
  }));
}

export function findCrossReferenceViolations(graph: GraphV2): readonly InvariantViolation[] {
  const unmatched = new Map<string, CrossRefPair>();
  for (const pair of conflictBlockedPairs(graph)) {
    unmatched.set(pair.resolverId, pair);
  }

  const violations: InvariantViolation[] = [];
  collectResolverSideViolations({ graph, unmatched, violations });
  return [...violations, ...unmatchedPairViolations(unmatched)];
}
