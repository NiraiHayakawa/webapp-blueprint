// conflict の同一性・機械生成ノードの由来・blockage（設計正本 §2.5 / §2.6）。
//
// 機械生成ノードの ID は allocator から発番する（attempt や既存 ID の文字列合成は
// 使わない）。merge conflict・検証失敗・candidate 却下・Git 状態不確定を機械的に
// 区別するため、実行段階と統合段階で blockage の型を分ける。
import { z } from "zod";

import { assignmentFenceSchema, type AssignmentFence } from "./assignment.ts";
import {
  blockageIdSchema,
  commitIdSchema,
  conflictIdSchema,
  digestSchema,
  epochSchema,
  generatedNodeIdSchema,
  nonEmptyStringSchema,
  repoPathSchema,
  revisionSchema,
  taskIdSchema,
  type BlockageId,
  type CommitId,
  type ConflictId,
  type Digest,
  type Epoch,
  type GeneratedNodeId,
  type NonEmptyString,
  type PlannedNodeId,
  type RepoPath,
  type Revision,
} from "./brand.ts";
import {
  failedCheckSchema,
  gitObservationSchema,
  integrationJournalSchema,
  type FailedCheck,
  type GitObservation,
  type IntegrationJournal,
} from "./integration.ts";
import { candidateSchema } from "./work.ts";
import type { Candidate } from "./work.ts";

export interface ConflictDescriptor {
  readonly id: ConflictId;
  readonly targetNodeId: string;
  readonly targetCandidateCommit: CommitId;
  readonly canonicalHeadAtConflict: CommitId;
  readonly files: readonly RepoPath[];
  readonly detectedAtRevision: Revision;
}

export const conflictDescriptorSchema = z.strictObject({
  id: conflictIdSchema,
  targetNodeId: taskIdSchema,
  targetCandidateCommit: commitIdSchema,
  canonicalHeadAtConflict: commitIdSchema,
  files: z.array(repoPathSchema),
  detectedAtRevision: revisionSchema,
});

/**
 * repository_change ノードの由来。Planner が plan したノードか、conflict 解消の
 * ために機械が挿入したノードか。
 */
export type RepositoryOrigin =
  | { readonly purpose: "planned" }
  | {
      readonly purpose: "conflict_resolution";
      readonly resolves: GeneratedNodeId | PlannedNodeId;
      readonly conflict: ConflictDescriptor;
    };

interface BlockageBaseFields {
  readonly id: BlockageId;
  readonly reason: NonEmptyString;
  readonly occurredAtRevision: Revision;
}

const blockageBase = {
  id: blockageIdSchema,
  reason: nonEmptyStringSchema,
  occurredAtRevision: revisionSchema,
} as const;

/** 実行段階（Worker が claim しているノード）で記録される blockage。 */
export type ExecutionBlockage =
  | (BlockageBaseFields & { readonly kind: "worker_request"; readonly assignment: AssignmentFence })
  | (BlockageBaseFields & {
      readonly kind: "worker_terminated";
      readonly assignment: AssignmentFence;
      readonly terminationEvidence: NonEmptyString;
    })
  | (BlockageBaseFields & {
      readonly kind: "session_resumed";
      readonly assignment: AssignmentFence;
      readonly resumedToEpoch: Epoch;
    });

export const executionBlockageSchema = z.union([
  z.strictObject({
    ...blockageBase,
    kind: z.literal("worker_request"),
    assignment: assignmentFenceSchema,
  }),
  z.strictObject({
    ...blockageBase,
    kind: z.literal("worker_terminated"),
    assignment: assignmentFenceSchema,
    terminationEvidence: nonEmptyStringSchema,
  }),
  z.strictObject({
    ...blockageBase,
    kind: z.literal("session_resumed"),
    assignment: assignmentFenceSchema,
    resumedToEpoch: epochSchema,
  }),
]);

/** 統合段階で記録される blockage。candidate は常にノード側に保持される。 */
export type IntegrationBlockage =
  | (BlockageBaseFields & {
      readonly kind: "integration_replan_requested";
      readonly integration: IntegrationJournal;
    })
  | (BlockageBaseFields & {
      readonly kind: "candidate_rejected";
      readonly code: NonEmptyString;
      readonly evidenceDigest: Digest;
    })
  | (BlockageBaseFields & {
      readonly kind: "integration_conflict";
      readonly integration: IntegrationJournal;
      readonly conflict: ConflictDescriptor;
      readonly resolutionNodeId: GeneratedNodeId;
      /** conflict 記録前に canonical が clean へ戻されたことの証跡（§6.4 の cleanup 義務）。 */
      readonly canonicalAfterCleanup: { readonly head: CommitId; readonly worktree: "clean" };
    })
  | (BlockageBaseFields & {
      readonly kind: "verification_failed";
      readonly integration: IntegrationJournal;
      readonly failure: FailedCheck;
      readonly observedGit: GitObservation;
    })
  | (BlockageBaseFields & {
      readonly kind: "integration_state_uncertain";
      readonly integration: IntegrationJournal;
      readonly observedGit: GitObservation;
    });

export const integrationBlockageSchema = z.union([
  z.strictObject({
    ...blockageBase,
    kind: z.literal("integration_replan_requested"),
    integration: integrationJournalSchema,
  }),
  z.strictObject({
    ...blockageBase,
    kind: z.literal("candidate_rejected"),
    code: nonEmptyStringSchema,
    evidenceDigest: digestSchema,
  }),
  z.strictObject({
    ...blockageBase,
    kind: z.literal("integration_conflict"),
    integration: integrationJournalSchema,
    conflict: conflictDescriptorSchema,
    resolutionNodeId: generatedNodeIdSchema,
    canonicalAfterCleanup: z.strictObject({ head: commitIdSchema, worktree: z.literal("clean") }),
  }),
  z.strictObject({
    ...blockageBase,
    kind: z.literal("verification_failed"),
    integration: integrationJournalSchema,
    failure: failedCheckSchema,
    observedGit: gitObservationSchema,
  }),
  z.strictObject({
    ...blockageBase,
    kind: z.literal("integration_state_uncertain"),
    integration: integrationJournalSchema,
    observedGit: gitObservationSchema,
  }),
]);

/**
 * blockage 発生時のノード状態のスナップショット。reopen の ResolutionRecord が
 * 「直前の blockage」の証跡として保持する（§2.6）。
 */
export type BlockedSnapshot =
  | { readonly phase: "execution"; readonly blockage: ExecutionBlockage }
  | {
      readonly phase: "integration";
      readonly candidate: Candidate;
      readonly blockage: IntegrationBlockage;
    };

const blockedSnapshotSchema = z.union([
  z.strictObject({ phase: z.literal("execution"), blockage: executionBlockageSchema }),
  z.strictObject({
    phase: z.literal("integration"),
    candidate: candidateSchema,
    blockage: integrationBlockageSchema,
  }),
]);

/** blocked → pending の reopen transaction だけが resolutions へ追記できる（§2.6）。 */
export interface ResolutionRecord {
  readonly previous: BlockedSnapshot;
  readonly resolution: NonEmptyString;
  readonly reopenedAtRevision: Revision;
}

export const resolutionRecordSchema = z.strictObject({
  previous: blockedSnapshotSchema,
  resolution: nonEmptyStringSchema,
  reopenedAtRevision: revisionSchema,
});
