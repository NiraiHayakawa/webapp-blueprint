// record_integration_outcome の失敗系 outcome（verification_failed /
// candidate_rejected / integration_state_uncertain）が作る integration blockage の
// 組み立てと、blocked variant への適用。record-integration-outcome.ts 本体から
// 分離した（codopsy の max-lines / 複雑度ゲート対応。挙動変更なし）。
import {
  blockageIdSchema,
  nonZeroExitCodeSchema,
  type Digest,
  type NonEmptyString,
  type Revision,
} from "../brand.ts";
import { allocateId, finalizeTransaction, nextRevision } from "../transaction.ts";
import type { FailedCheck, GitObservation } from "../integration.ts";
import type { IntegrationBlockage } from "../blockage.ts";
import type { GraphV2 } from "../graph.ts";
import type { GraphNode, RepositoryNode } from "../nodes.ts";

export type IntegratingTask = Extract<RepositoryNode, { readonly status: "integrating" }>;
type IntegrationBlockedVariant = Extract<RepositoryNode, { readonly status: "blocked" }>;

type ConflictResolutionIntegrating = Extract<
  IntegratingTask,
  { readonly purpose: "conflict_resolution" }
>;

export function originParts(
  node: IntegratingTask,
):
  | { readonly purpose: "planned" }
  | Pick<ConflictResolutionIntegrating, "purpose" | "resolves" | "conflict"> {
  return node.purpose === "conflict_resolution"
    ? { purpose: "conflict_resolution", resolves: node.resolves, conflict: node.conflict }
    : { purpose: "planned" };
}

export function occurredAt(graph: GraphV2): Revision {
  // この transaction が確定する revision（現在値 +1）を「発生時点」として刻む
  return nextRevision(graph);
}

/** exitCode を branded 契約へ通してから証跡にする（0 はここに来ない。成功は success 経路）。 */
function withCommand(failure: Omit<FailedCheck, "command">): FailedCheck {
  return {
    command: "mise run check",
    checkedCommit: failure.checkedCommit,
    exitCode: nonZeroExitCodeSchema.parse(failure.exitCode),
    outputDigest: failure.outputDigest,
    finishedAt: failure.finishedAt,
  };
}

function blockAs(graph: GraphV2, target: IntegratingTask, blockage: IntegrationBlockage): GraphV2 {
  const blocked: IntegrationBlockedVariant = {
    kind: "task",
    id: target.id,
    title: target.title,
    deps: target.deps,
    resolutions: target.resolutions,
    ...originParts(target),
    effect: "repository_change",
    status: "blocked",
    phase: "integration",
    candidate: target.candidate,
    blockage,
  };
  const nodes: GraphNode[] = graph.nodes.map((node) => (node.id === target.id ? blocked : node));
  return finalizeTransaction({ ...graph, nodes });
}

/** 検証（mise run check）の失敗。FailedCheck 証跡と Git 観測を保持する。 */
export function blockAsVerificationFailed(
  graph: GraphV2,
  target: IntegratingTask,
  input: {
    readonly reason: NonEmptyString;
    readonly failure: FailedCheck;
    readonly observedGit: GitObservation;
  },
): GraphV2 {
  const allocated = allocateId(graph);
  return blockAs(allocated.graph, target, {
    kind: "verification_failed",
    reason: input.reason,
    id: blockageIdSchema.parse(allocated.id),
    occurredAtRevision: occurredAt(graph),
    integration: target.integration,
    failure: withCommand(input.failure),
    observedGit: input.observedGit,
  });
}

/** candidate の内容不備。code と証拠ダイジェストを保持する。 */
export function blockAsCandidateRejected(
  graph: GraphV2,
  target: IntegratingTask,
  rejection: {
    readonly reason: NonEmptyString;
    readonly code: NonEmptyString;
    readonly evidenceDigest: Digest;
  },
): GraphV2 {
  const allocated = allocateId(graph);
  return blockAs(allocated.graph, target, {
    kind: "candidate_rejected",
    reason: rejection.reason,
    id: blockageIdSchema.parse(allocated.id),
    occurredAtRevision: occurredAt(graph),
    code: rejection.code,
    evidenceDigest: rejection.evidenceDigest,
  });
}

/** 状態を決定的に確定できない場合（fail-closed）。journal と Git 観測を保持する。 */
export function blockAsStateUncertain(
  graph: GraphV2,
  target: IntegratingTask,
  uncertain: { readonly reason: NonEmptyString; readonly observedGit: GitObservation },
): GraphV2 {
  const allocated = allocateId(graph);
  return blockAs(allocated.graph, target, {
    kind: "integration_state_uncertain",
    reason: uncertain.reason,
    id: blockageIdSchema.parse(allocated.id),
    occurredAtRevision: occurredAt(graph),
    integration: target.integration,
    observedGit: uncertain.observedGit,
  });
}
