// fenced assignment（設計正本 §2.2）。
//
// fence は { nodeId, runId, epoch, assignmentId } の完全一致で検査される。assignmentId は
// allocator からの発番であり再利用しない（新しい run との ABA を防ぐ）。時間 lease は
// 持たない。startedAt は診断情報であり、時刻による状態遷移は存在しない。
import { z } from "zod";

import {
  assignmentIdSchema,
  epochSchema,
  isoDateTimeSchema,
  commitIdSchema,
  runIdSchema,
  taskIdSchema,
  workspaceIdSchema,
} from "./brand.ts";
import type {
  AssignmentId,
  CommitId,
  Epoch,
  IsoDateTime,
  RunId,
  TaskNodeId,
  WorkspaceId,
} from "./brand.ts";

/**
 * 実行中の claim を識別する完全一致検査用の4要素。完了系ツールはこの値を
 * 提示し、ノードに書き込まれた assignment と一致しない書き込みは拒否される。
 */
export interface AssignmentFence {
  readonly id: AssignmentId;
  readonly nodeId: TaskNodeId;
  readonly runId: RunId;
  readonly epoch: Epoch;
}

export const assignmentFenceSchema = z.strictObject({
  id: assignmentIdSchema,
  nodeId: taskIdSchema,
  runId: runIdSchema,
  epoch: epochSchema,
});

/** assignment から fence 部分（完全一致検査に使う4要素）を取り出す。 */
export function fenceOf(assignment: AssignmentFence): AssignmentFence {
  return {
    id: assignment.id,
    nodeId: assignment.nodeId,
    runId: assignment.runId,
    epoch: assignment.epoch,
  };
}

/** fence の完全一致。1 フィールドでも違えば不一致（stale fence）。 */
export function sameFence(a: AssignmentFence, b: AssignmentFence): boolean {
  return a.id === b.id && a.nodeId === b.nodeId && a.runId === b.runId && a.epoch === b.epoch;
}

export interface ReadOnlyWorkerAssignment extends AssignmentFence {
  readonly role: "worker";
  readonly effect: "read_only";
  readonly startedAt: IsoDateTime;
}

export const readOnlyWorkerAssignmentSchema = assignmentFenceSchema.extend({
  role: z.literal("worker"),
  effect: z.literal("read_only"),
  startedAt: isoDateTimeSchema,
});

export interface RepositoryWorkerAssignment extends AssignmentFence {
  readonly role: "worker";
  readonly effect: "repository_change";
  /** claim 時に割り当てられた隔離 worktree。Worker はここでだけ編集する（§6.1）。 */
  readonly workspaceId: WorkspaceId;
  readonly baseCommit: CommitId;
  readonly startedAt: IsoDateTime;
}

export const repositoryWorkerAssignmentSchema = assignmentFenceSchema.extend({
  role: z.literal("worker"),
  effect: z.literal("repository_change"),
  workspaceId: workspaceIdSchema,
  baseCommit: commitIdSchema,
  startedAt: isoDateTimeSchema,
});

export interface IntegratorAssignment extends AssignmentFence {
  readonly role: "integrator";
  /** canonical ではない統合用 worktree。canonical への publish は §6.4 の単一 authority だけが行う。 */
  readonly workspaceId: WorkspaceId;
  readonly startedAt: IsoDateTime;
}

export const integratorAssignmentSchema = assignmentFenceSchema.extend({
  role: z.literal("integrator"),
  workspaceId: workspaceIdSchema,
  startedAt: isoDateTimeSchema,
});

/** Worker ロールの assignment。claim_ready が read_only / repository_change に応じて作る。 */
export type WorkerAssignment = ReadOnlyWorkerAssignment | RepositoryWorkerAssignment;
