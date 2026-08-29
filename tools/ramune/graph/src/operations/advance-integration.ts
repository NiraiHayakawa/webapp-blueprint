// advance_integration: journal を merge_prepared / publish_prepared へ前進させる
// （ramune_advance_integration のグラフ層。§6.2）。fence の完全一致を要求する。
//
// 段階は claimed → merge_prepared → publish_prepared の順にしか進まない。
// publish_prepared は canonical への CAS より先に永続化される（crash 後の照合で
// 「publish 直前まで進んでいた」ことを確定できるようにするため）。
// publish_prepared への前進には統合結果に対する 1 コマンド検証（mise run check。
// 絶対規約 8）の成功証跡を必須とし、検証対象 commit が integratedCommit と一致
// しない証跡は受理しない（fail-fast。別の commit を検証した証跡で先へ進めない）。
import type { GraphV2 } from "../graph.ts";
import { finalizeTransaction } from "../transaction.ts";
import type { AssignmentFence } from "../assignment.ts";
import { requireIntegratingTarget } from "./integrating-target.ts";
import type { IntegrationProgress, SuccessfulCheck } from "../integration.ts";
import type { CommitId, Digest, IsoDateTime } from "../brand.ts";
import type { GraphNode, RepositoryNode } from "../nodes.ts";

export type AdvanceIntegrationProgress =
  | { readonly stage: "merge_prepared"; readonly integratedCommit: CommitId }
  | {
      readonly stage: "publish_prepared";
      readonly integratedCommit: CommitId;
      readonly verification: {
        readonly checkedCommit: CommitId;
        readonly outputDigest: Digest;
        readonly finishedAt: IsoDateTime;
      };
    };

export interface AdvanceIntegrationOperation {
  readonly type: "advance_integration";
  readonly fence: AssignmentFence;
  readonly progress: AdvanceIntegrationProgress;
}

export type AdvanceIntegrationPreconditionViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | { readonly reason: "not_integrating"; readonly nodeId: string; readonly status: string }
  | { readonly reason: "stale_fence"; readonly nodeId: string }
  | {
      readonly reason: "invalid_stage_order";
      readonly currentStage: string;
      readonly nextStage: string;
    }
  | {
      readonly reason: "integrated_commit_mismatch";
      readonly nodeId: string;
      readonly mergedCommit: CommitId;
      readonly presentedCommit: CommitId;
    }
  | {
      readonly reason: "verification_commit_mismatch";
      readonly nodeId: string;
      readonly integratedCommit: CommitId;
      readonly checkedCommit: CommitId;
    };

export class AdvanceIntegrationPreconditionError extends Error {
  readonly violation: AdvanceIntegrationPreconditionViolation;

  constructor(violation: AdvanceIntegrationPreconditionViolation) {
    super(`advance_integration の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "AdvanceIntegrationPreconditionError";
    this.violation = violation;
  }
}

const STAGE_ORDER: ReadonlyMap<string, number> = new Map([
  ["claimed", 0],
  ["merge_prepared", 1],
  ["publish_prepared", 2],
]);

type IntegratingTaskNode = Extract<RepositoryNode, { readonly status: "integrating" }>;

type Fail = (violation: AdvanceIntegrationPreconditionViolation) => never;

function isIntegrating(node: GraphNode): node is IntegratingTaskNode {
  return (
    node.kind === "task" && node.effect === "repository_change" && node.status === "integrating"
  );
}

function findIntegratingTarget(
  graph: GraphV2,
  op: AdvanceIntegrationOperation,
  fail: Fail,
): IntegratingTaskNode {
  return requireIntegratingTarget(graph, op.fence, fail);
}

function assertStageOrder(
  target: IntegratingTaskNode,
  op: AdvanceIntegrationOperation,
  fail: Fail,
): void {
  const currentStage = target.integration.progress.stage;
  const currentRank = STAGE_ORDER.get(currentStage);
  const nextRank = STAGE_ORDER.get(op.progress.stage);
  if (currentRank === undefined || nextRank === undefined || nextRank !== currentRank + 1) {
    return fail({
      reason: "invalid_stage_order",
      currentStage,
      nextStage: op.progress.stage,
    });
  }
}

/** merge_prepared の統合コミットと publish_prepared 提示値の一致（別 commit を検証して進めない）。 */
function assertIntegratedCommitConsistent(
  target: IntegratingTaskNode,
  op: AdvanceIntegrationOperation,
  fail: Fail,
): void {
  if (
    op.progress.stage !== "publish_prepared" ||
    target.integration.progress.stage !== "merge_prepared"
  ) {
    return;
  }
  if (target.integration.progress.integratedCommit === op.progress.integratedCommit) {
    return;
  }
  return fail({
    reason: "integrated_commit_mismatch",
    nodeId: op.fence.nodeId,
    mergedCommit: target.integration.progress.integratedCommit,
    presentedCommit: op.progress.integratedCommit,
  });
}

function verificationOf(op: AdvanceIntegrationOperation, fail: Fail): SuccessfulCheck | undefined {
  if (op.progress.stage !== "publish_prepared") {
    return undefined;
  }
  if (op.progress.verification.checkedCommit !== op.progress.integratedCommit) {
    return fail({
      reason: "verification_commit_mismatch",
      nodeId: op.fence.nodeId,
      integratedCommit: op.progress.integratedCommit,
      checkedCommit: op.progress.verification.checkedCommit,
    });
  }
  return {
    command: "mise run check",
    exitCode: 0,
    checkedCommit: op.progress.verification.checkedCommit,
    outputDigest: op.progress.verification.outputDigest,
    finishedAt: op.progress.verification.finishedAt,
  };
}

function progressOf(
  op: AdvanceIntegrationOperation,
  verification: SuccessfulCheck | undefined,
): IntegrationProgress {
  if (op.progress.stage === "publish_prepared") {
    if (verification === undefined) {
      // verificationOf は op.progress.stage === "publish_prepared" のとき必ず
      // SuccessfulCheck を返す（undefined は他 stage 用の早期 return のみ）。
      throw new TypeError("publish_prepared 段階では verification が必須");
    }
    return {
      stage: "publish_prepared",
      integratedCommit: op.progress.integratedCommit,
      verification,
    };
  }
  return { stage: "merge_prepared", integratedCommit: op.progress.integratedCommit };
}

export function advanceIntegration(graph: GraphV2, op: AdvanceIntegrationOperation): GraphV2 {
  const fail = (violation: AdvanceIntegrationPreconditionViolation): never => {
    throw new AdvanceIntegrationPreconditionError(violation);
  };

  const target = findIntegratingTarget(graph, op, fail);
  assertStageOrder(target, op, fail);
  assertIntegratedCommitConsistent(target, op, fail);
  const verification = verificationOf(op, fail);
  const progress = progressOf(op, verification);

  const nodes = graph.nodes.map((node): GraphNode =>
    isIntegrating(node) && node.id === target.id
      ? { ...node, integration: { ...node.integration, progress } }
      : node,
  );

  return finalizeTransaction({ ...graph, nodes });
}
