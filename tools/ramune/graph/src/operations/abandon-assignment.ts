// abandon_assignment: 死んだ Worker / Integrator の claim を回収する
// （ramune_abandon_assignment のグラフ層。§7）。Orchestrator が**終了を確認した後**に
// 呼ぶ。fence の完全一致を要求し、旧 Orchestrator の遅延した死亡確認が新 assignment
// を潰すことを防ぐ。
//
// - 実行段階（running ノード）: blocked(worker_terminated)。evidence は
//   terminationEvidence として記録される。observedGit は不要（渡せない）
// - 統合段階（integrating ノード）: observedGit を必須とし、journal と観測を突き合わせて
//   決定的に確定できる場合だけ状態を確定する:
//     * journal が publish_prepared かつ HEAD === integratedCommit → publish 済みとして
//       done（解消 chain 全体も同時に done）
//     * HEAD === canonicalHeadBefore かつ canonical clean → candidate を保持して
//       awaiting_integration へ戻す
//     * それ以外 → blocked(integration_state_uncertain)（fail-closed）
import type { GraphV2 } from "../graph.ts";
import { blockageIdSchema, type NonEmptyString } from "../brand.ts";
import { allocateId, finalizeTransaction, nextRevision } from "../transaction.ts";
import { requireTaskNode } from "./task-node.ts";
import { fenceOf, sameFence, type AssignmentFence } from "../assignment.ts";
import type { GitObservation } from "../integration.ts";
import type { ExecutionBlockage, IntegrationBlockage } from "../blockage.ts";
import { closeResolutionChain } from "./integration-chain.ts";
import { throwAbandonAssignmentPreconditionError } from "./abandon-assignment-error.ts";
import {
  awaitingVariant,
  executionBlockedRepositoryVariant,
  executionBlockedVariant,
  integrationBlockedVariant,
  replace,
  type IntegratingTaskNode,
  type RunningReadOnlyNode,
  type RunningRepositoryNode,
} from "./abandon-assignment-node-variants.ts";
import type { GraphNode } from "../nodes.ts";

export {
  AbandonAssignmentPreconditionError,
  type AbandonAssignmentPreconditionViolation,
} from "./abandon-assignment-error.ts";

export interface AbandonAssignmentOperation {
  readonly type: "abandon_assignment";
  readonly fence: AssignmentFence;
  /** 終了の証拠（プロセスの終了確認、タイムアウトの記録など）。 */
  readonly evidence: NonEmptyString;
  /** 統合段階の死亡確認で必須。実行段階では渡せない（余計な入力は黙って捨てない）。 */
  readonly observedGit?: GitObservation;
}

function findAbandonTarget(graph: GraphV2, op: AbandonAssignmentOperation): GraphNode {
  return requireTaskNode(graph, op.fence.nodeId, (violation) => {
    if (violation.reason === "node_not_found") {
      return throwAbandonAssignmentPreconditionError({
        reason: "node_not_found",
        nodeId: op.fence.nodeId,
      });
    }
    // boundary ノードは fence の nodeId になり得ないため、stale_fence として拒否する
    return throwAbandonAssignmentPreconditionError({
      reason: "stale_fence",
      nodeId: op.fence.nodeId,
      status: "boundary",
    });
  });
}

/** 実行段階（running）の abandon。fence 一致と observedGit 不要を検査して blocked 化する。 */
function abandonRunning(
  graph: GraphV2,
  op: AbandonAssignmentOperation,
  target: RunningReadOnlyNode | RunningRepositoryNode,
): GraphV2 {
  if (!sameFence(target.assignment, op.fence)) {
    return throwAbandonAssignmentPreconditionError({
      reason: "stale_fence",
      nodeId: target.id,
      status: target.status,
    });
  }
  if (op.observedGit) {
    return throwAbandonAssignmentPreconditionError({
      reason: "unnecessary_observed_git",
      nodeId: target.id,
    });
  }
  const allocated = allocateId(graph);
  const blockage: ExecutionBlockage = {
    id: blockageIdSchema.parse(allocated.id),
    reason: op.evidence,
    occurredAtRevision: nextRevision(graph),
    kind: "worker_terminated",
    assignment: op.fence,
    terminationEvidence: op.evidence,
  };
  if (target.effect === "read_only") {
    return finalizeTransaction({
      ...allocated.graph,
      nodes: replace(graph, target.id, executionBlockedVariant(target, blockage)),
    });
  }
  return finalizeTransaction({
    ...allocated.graph,
    nodes: replace(graph, target.id, executionBlockedRepositoryVariant(target, blockage)),
  });
}

type ReconciliationDecision = "close_chain" | "restore_awaiting" | "uncertain";

/** §7 の照合決定則。journal の段階と Git 観測から、決定的に確定できる場合だけ遷移する。 */
function decideReconciliation(
  target: IntegratingTaskNode,
  observation: GitObservation,
): ReconciliationDecision {
  const { progress } = target.integration;
  if (
    progress.stage === "publish_prepared" &&
    observation.canonicalHead === progress.integratedCommit
  ) {
    return "close_chain";
  }
  if (
    observation.canonicalHead === target.integration.canonicalHeadBefore &&
    observation.canonicalWorktree === "clean"
  ) {
    return "restore_awaiting";
  }
  return "uncertain";
}

function closePublishedIntegration(graph: GraphV2, target: IntegratingTaskNode): GraphV2 {
  const journal = target.integration;
  const { progress } = journal;
  if (progress.stage !== "publish_prepared") {
    // decideReconciliation が "close_chain" を返すのは stage === "publish_prepared" の
    // ときだけなので、ここに到達する場合は呼び出し側の不変条件が壊れている
    throw new TypeError(`integration journal の stage が publish_prepared ではない: ${target.id}`);
  }
  const nodes = closeResolutionChain(graph, {
    terminalId: target.id,
    integratedCommit: progress.integratedCommit,
    verification: progress.verification,
    report: target.candidate.report,
    integratedBy: fenceOf(journal.assignment),
  });
  if (!nodes) {
    return throwAbandonAssignmentPreconditionError({
      reason: "broken_resolution_chain",
      nodeId: target.id,
    });
  }
  return finalizeTransaction({ ...graph, nodes });
}

function markIntegrationUncertain(
  graph: GraphV2,
  target: IntegratingTaskNode,
  op: AbandonAssignmentOperation & { readonly observedGit: GitObservation },
): GraphV2 {
  const allocated = allocateId(graph);
  const blockage: IntegrationBlockage = {
    id: blockageIdSchema.parse(allocated.id),
    reason: op.evidence,
    occurredAtRevision: nextRevision(graph),
    kind: "integration_state_uncertain",
    integration: target.integration,
    observedGit: op.observedGit,
  };
  return finalizeTransaction({
    ...allocated.graph,
    nodes: replace(graph, target.id, integrationBlockedVariant(target, blockage)),
  });
}

function reconcileIntegration(
  graph: GraphV2,
  target: IntegratingTaskNode,
  op: AbandonAssignmentOperation & { readonly observedGit: GitObservation },
): GraphV2 {
  const decision = decideReconciliation(target, op.observedGit);
  if (decision === "close_chain") {
    return closePublishedIntegration(graph, target);
  }
  if (decision === "restore_awaiting") {
    return finalizeTransaction({
      ...graph,
      nodes: replace(graph, target.id, awaitingVariant(target)),
    });
  }
  return markIntegrationUncertain(graph, target, op);
}

/** 統合段階（integrating）の abandon。observedGit 必須で §7 の照合へ委譲する。 */
function abandonIntegrating(
  graph: GraphV2,
  op: AbandonAssignmentOperation,
  target: IntegratingTaskNode,
): GraphV2 {
  if (!sameFence(target.integration.assignment, op.fence)) {
    return throwAbandonAssignmentPreconditionError({
      reason: "stale_fence",
      nodeId: target.id,
      status: target.status,
    });
  }
  if (!op.observedGit) {
    return throwAbandonAssignmentPreconditionError({
      reason: "observed_git_required",
      nodeId: target.id,
    });
  }
  return reconcileIntegration(graph, target, { ...op, observedGit: op.observedGit });
}

export function abandonAssignment(graph: GraphV2, op: AbandonAssignmentOperation): GraphV2 {
  const target = findAbandonTarget(graph, op);

  if (target.status === "running") {
    return abandonRunning(graph, op, target);
  }
  if (
    target.kind === "task" &&
    target.effect === "repository_change" &&
    target.status === "integrating"
  ) {
    return abandonIntegrating(graph, op, target);
  }
  return throwAbandonAssignmentPreconditionError({
    reason: "stale_fence",
    nodeId: target.id,
    status: target.status,
  });
}
