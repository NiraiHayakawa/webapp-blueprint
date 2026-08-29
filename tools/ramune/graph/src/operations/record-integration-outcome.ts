// record_integration_outcome: 統合の結果を1つの操作契約で受ける（§8）。
//
// - success: publish_prepared まで進んだ journal を完了証跡へ変換し、解消 chain
//   全体を同時に done にする（integration-chain.ts。§6.3）
// - conflict: 衝突したノード C を blocked(integration_conflict) にして candidate を
//   保持し、解消ノード R を機械的に挿入する。ID は allocator から発番する
//   （ADR 0012。§6.3）。R の deps は C.deps のコピーであり、すべて done のため即 ready
// - verification_failed / candidate_rejected / integration_state_uncertain:
//   対応する blockage へ遷移する。candidate と journal は blockage 内に保持され、
//   ノードが嘘のない形で止まる
//
// いずれの失敗経路でも、Integrator は canonical を clean に戻した後で記録する
// （cleanup 義務は §6.4。conflict 経路では canonicalAfterCleanup 証跡を必須とする）。
import type { GraphV2 } from "../graph.ts";
import {
  blockageIdSchema,
  conflictIdSchema,
  generatedNodeIdSchema,
  type CommitId,
  type Digest,
  type NonEmptyString,
  type RepoPath,
} from "../brand.ts";
import { allocateId, finalizeTransaction } from "../transaction.ts";
import { fenceOf, type AssignmentFence } from "../assignment.ts";
import type { FailedCheck, GitObservation } from "../integration.ts";
import type { ConflictDescriptor } from "../blockage.ts";
import { closeResolutionChain } from "./integration-chain.ts";
import {
  blockAsCandidateRejected,
  blockAsStateUncertain,
  blockAsVerificationFailed,
  occurredAt,
  originParts,
} from "./integration-outcome-blockage.ts";
import type { IntegratingTask } from "./integration-outcome-blockage.ts";
import { requireIntegratingTarget } from "./integrating-target.ts";
import type { GraphNode, RepositoryNode } from "../nodes.ts";

export interface RecordIntegrationOutcomeOperation {
  readonly type: "record_integration_outcome";
  readonly fence: AssignmentFence;
  readonly outcome:
    | { readonly kind: "success" }
    | {
        readonly kind: "conflict";
        readonly reason: NonEmptyString;
        /** 挿入される解消ノードのタイトル。 */
        readonly title: NonEmptyString;
        readonly files: readonly RepoPath[];
        readonly canonicalHeadAtConflict: CommitId;
        /** conflict 記録前に canonical を clean へ戻したことの証跡（§6.4 の cleanup 義務）。 */
        readonly canonicalAfterCleanup: {
          readonly head: CommitId;
          readonly worktree: "clean";
        };
      }
    | {
        readonly kind: "verification_failed";
        readonly reason: NonEmptyString;
        readonly failure: FailedCheck;
        readonly observedGit: GitObservation;
      }
    | {
        readonly kind: "candidate_rejected";
        readonly reason: NonEmptyString;
        readonly code: NonEmptyString;
        readonly evidenceDigest: Digest;
      }
    | {
        readonly kind: "integration_state_uncertain";
        readonly reason: NonEmptyString;
        readonly observedGit: GitObservation;
      };
}

export type RecordIntegrationOutcomePreconditionViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | { readonly reason: "not_integrating"; readonly nodeId: string; readonly status: string }
  | { readonly reason: "stale_fence"; readonly nodeId: string }
  | {
      readonly reason: "journal_not_publish_prepared";
      readonly nodeId: string;
      readonly stage: string;
    }
  | { readonly reason: "broken_resolution_chain"; readonly nodeId: string };

export class RecordIntegrationOutcomePreconditionError extends Error {
  readonly violation: RecordIntegrationOutcomePreconditionViolation;

  constructor(violation: RecordIntegrationOutcomePreconditionViolation) {
    super(`record_integration_outcome の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "RecordIntegrationOutcomePreconditionError";
    this.violation = violation;
  }
}

type IntegrationBlockedVariant = Extract<RepositoryNode, { readonly status: "blocked" }>;

type Fail = (violation: RecordIntegrationOutcomePreconditionViolation) => never;

function findIntegratingTarget(
  graph: GraphV2,
  op: RecordIntegrationOutcomeOperation,
  fail: Fail,
): IntegratingTask {
  return requireIntegratingTarget(graph, op.fence, fail);
}

function applySuccess(
  graph: GraphV2,
  target: IntegratingTask,
  fail: (violation: RecordIntegrationOutcomePreconditionViolation) => never,
): GraphV2 {
  const { progress } = target.integration;
  if (progress.stage !== "publish_prepared") {
    return fail({
      reason: "journal_not_publish_prepared",
      nodeId: target.id,
      stage: progress.stage,
    });
  }
  const nodes = closeResolutionChain(graph, {
    terminalId: target.id,
    integratedCommit: progress.integratedCommit,
    verification: progress.verification,
    report: target.candidate.report,
    integratedBy: fenceOf(target.integration.assignment),
  });
  if (!nodes) {
    return fail({ reason: "broken_resolution_chain", nodeId: target.id });
  }
  return finalizeTransaction({ ...graph, nodes });
}

type ConflictOutcome = Extract<
  RecordIntegrationOutcomeOperation["outcome"],
  { readonly kind: "conflict" }
>;

interface ConflictInsertionIds {
  readonly graph: GraphV2;
  readonly blockageId: ReturnType<typeof blockageIdSchema.parse>;
  readonly conflictId: ReturnType<typeof conflictIdSchema.parse>;
  readonly resolverNodeId: ReturnType<typeof generatedNodeIdSchema.parse>;
}

/** conflict 記録に必要な 3 つの ID（blockage / conflict / 解消ノード）を発番する。 */
function allocateConflictInsertionIds(graph: GraphV2): ConflictInsertionIds {
  const first = allocateId(graph);
  const second = allocateId(first.graph);
  const third = allocateId(second.graph);
  return {
    graph: third.graph,
    blockageId: blockageIdSchema.parse(first.id),
    conflictId: conflictIdSchema.parse(second.id),
    resolverNodeId: generatedNodeIdSchema.parse(`gen-${String(third.id)}`),
  };
}

interface ConflictInsertionContext {
  readonly target: IntegratingTask;
  readonly outcome: ConflictOutcome;
  readonly ids: ConflictInsertionIds;
  readonly detectedAt: ReturnType<typeof occurredAt>;
}

function buildConflictDescriptor(ctx: ConflictInsertionContext): ConflictDescriptor {
  const { target, outcome, ids, detectedAt } = ctx;
  return {
    id: ids.conflictId,
    targetNodeId: target.id,
    targetCandidateCommit: target.candidate.commit,
    canonicalHeadAtConflict: outcome.canonicalHeadAtConflict,
    files: [...outcome.files],
    detectedAtRevision: detectedAt,
  };
}

function buildConflictedNode(
  ctx: ConflictInsertionContext,
  conflict: ConflictDescriptor,
): IntegrationBlockedVariant {
  const { target, outcome, ids, detectedAt } = ctx;
  return {
    kind: "task",
    id: target.id,
    title: target.title,
    deps: [...target.deps, ids.resolverNodeId],
    resolutions: target.resolutions,
    ...originParts(target),
    effect: "repository_change",
    status: "blocked",
    phase: "integration",
    candidate: target.candidate,
    blockage: {
      id: ids.blockageId,
      reason: outcome.reason,
      occurredAtRevision: detectedAt,
      kind: "integration_conflict",
      integration: target.integration,
      conflict,
      resolutionNodeId: ids.resolverNodeId,
      canonicalAfterCleanup: {
        head: outcome.canonicalAfterCleanup.head,
        worktree: "clean",
      },
    },
  };
}

function buildResolverNode(
  ctx: ConflictInsertionContext,
  conflict: ConflictDescriptor,
): RepositoryNode {
  const { target, outcome, ids } = ctx;
  return {
    kind: "task",
    id: ids.resolverNodeId,
    title: outcome.title,
    deps: [...target.deps],
    resolutions: [],
    purpose: "conflict_resolution",
    resolves: target.id,
    conflict,
    effect: "repository_change",
    status: "pending",
  };
}

/**
 * §6.3: 単一 transaction 内で
 *   1. C を blocked(integration_conflict) へ（candidate 保持）
 *   2. 解消ノード R を allocator 発番の ID で機械挿入（deps は C.deps のコピー。
 *      すべて done のため即 ready）
 *   3. C.deps に R の ID を追記し、blockage.resolutionNodeId ↔ R.resolves の相互参照
 *      と conflict descriptor を同時に書く
 */
function applyConflictInsertion(
  graph: GraphV2,
  target: IntegratingTask,
  outcome: ConflictOutcome,
): GraphV2 {
  const ids = allocateConflictInsertionIds(graph);
  const ctx: ConflictInsertionContext = { target, outcome, ids, detectedAt: occurredAt(graph) };
  const conflict = buildConflictDescriptor(ctx);
  const conflicted = buildConflictedNode(ctx, conflict);
  const resolver = buildResolverNode(ctx, conflict);

  const nodes: GraphNode[] = graph.nodes.map((node) => (node.id === target.id ? conflicted : node));
  // R は配列の末尾へ追加する。宣言順選択の相対順序を既存ノードの間で壊さないため
  nodes.push(resolver);

  return finalizeTransaction({ ...ids.graph, nodes });
}

export function recordIntegrationOutcome(
  graph: GraphV2,
  op: RecordIntegrationOutcomeOperation,
): GraphV2 {
  const fail = (violation: RecordIntegrationOutcomePreconditionViolation): never => {
    throw new RecordIntegrationOutcomePreconditionError(violation);
  };
  const target = findIntegratingTarget(graph, op, fail);

  switch (op.outcome.kind) {
    case "success": {
      return applySuccess(graph, target, fail);
    }
    case "conflict": {
      return applyConflictInsertion(graph, target, op.outcome);
    }
    case "verification_failed": {
      return blockAsVerificationFailed(graph, target, op.outcome);
    }
    case "candidate_rejected": {
      return blockAsCandidateRejected(graph, target, op.outcome);
    }
    case "integration_state_uncertain": {
      return blockAsStateUncertain(graph, target, op.outcome);
    }
    default: {
      // 網羅性チェック: outcome の種別が増えたのにここが更新されていない場合、
      // ここで型検査が落ちる
      const exhaustive: never = op.outcome;
      throw new Error(`unknown outcome kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
