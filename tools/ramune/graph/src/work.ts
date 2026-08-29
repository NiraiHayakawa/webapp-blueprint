// 成果物と完了証跡（設計正本 §2.3 / §2.7）。
//
// result に三役（作業報告・conflict 入力・完了証跡）を兼ねさせない。作業報告は
// WorkReport、candidate の由来は Candidate.source、完了証跡は done variant 専用の
// result 型に分離する。envelope 自体の null は許さない（data: null は許す）。
import { z } from "zod";

import {
  commitIdSchema,
  conflictIdSchema,
  generatedNodeIdSchema,
  isoDateTimeSchema,
  jsonValueSchema,
  nonEmptyStringSchema,
  type CommitId,
  type ConflictId,
  type GeneratedNodeId,
  type IsoDateTime,
  type JsonValue,
  type NonEmptyString,
} from "./brand.ts";
import { assignmentFenceSchema, repositoryWorkerAssignmentSchema } from "./assignment.ts";
import type { AssignmentFence, RepositoryWorkerAssignment } from "./assignment.ts";
import { successfulCheckSchema } from "./integration.ts";
import type { SuccessfulCheck } from "./integration.ts";

export interface WorkReport {
  readonly summary: NonEmptyString;
  readonly data: JsonValue;
}

const workReportSchema = z.strictObject({
  summary: nonEmptyStringSchema,
  data: jsonValueSchema,
});

export interface Candidate {
  readonly commit: CommitId;
  /**
   * submit 時にサーバが current assignment からコピーする。
   * Worker の入力として baseCommit / workspaceId を受け取らない（Worker の申告を信用しない）。
   */
  readonly source: RepositoryWorkerAssignment;
  readonly report: WorkReport;
  readonly submittedAt: IsoDateTime;
}

export const candidateSchema = z.strictObject({
  commit: commitIdSchema,
  source: repositoryWorkerAssignmentSchema,
  report: workReportSchema,
  submittedAt: isoDateTimeSchema,
});

/** read_only ノードの完了証跡。record_result だけが書ける。 */
export interface ReadOnlyResult extends WorkReport {
  readonly kind: "read_only";
  readonly completedBy: AssignmentFence;
}

export const readOnlyResultSchema = z.strictObject({
  kind: z.literal("read_only"),
  summary: nonEmptyStringSchema,
  data: jsonValueSchema,
  completedBy: assignmentFenceSchema,
});

/** planned ノードの統合成功の完了証跡。 */
export interface IntegratedRepositoryResult extends WorkReport {
  readonly kind: "integrated";
  readonly candidateCommit: CommitId;
  readonly integratedCommit: CommitId;
  readonly integratedBy: AssignmentFence;
  readonly verification: SuccessfulCheck;
}

const integratedRepositoryResultSchema = z.strictObject({
  kind: z.literal("integrated"),
  summary: nonEmptyStringSchema,
  data: jsonValueSchema,
  candidateCommit: commitIdSchema,
  integratedCommit: commitIdSchema,
  integratedBy: assignmentFenceSchema,
  verification: successfulCheckSchema,
});

/** conflict 解消ノード R の統合成功が、解消対象 C を同時に done するときの完了証跡。 */
export interface ConflictResolvedRepositoryResult extends WorkReport {
  readonly kind: "conflict_resolved";
  readonly conflictId: ConflictId;
  readonly originalCandidateCommit: CommitId;
  readonly resolutionNodeId: GeneratedNodeId;
  readonly integratedCommit: CommitId;
  readonly verification: SuccessfulCheck;
}

const conflictResolvedRepositoryResultSchema = z.strictObject({
  kind: z.literal("conflict_resolved"),
  summary: nonEmptyStringSchema,
  data: jsonValueSchema,
  conflictId: conflictIdSchema,
  originalCandidateCommit: commitIdSchema,
  resolutionNodeId: generatedNodeIdSchema,
  integratedCommit: commitIdSchema,
  verification: successfulCheckSchema,
});

export type RepositoryResult = IntegratedRepositoryResult | ConflictResolvedRepositoryResult;

export const repositoryResultSchema = z.union([
  integratedRepositoryResultSchema,
  conflictResolvedRepositoryResultSchema,
]);
