// packages/graph の公開面。re-export のみ（packages/README.md「公開面の規約」）。

// 型とコンストラクタ
export { type GraphV2, type GraphSession, createGraph, findNode } from "./graph.ts";

export {
  type GraphNode,
  type BoundaryNode,
  type StartBoundaryNode,
  type EndBoundaryNode,
  type BoundaryResult,
  type ReadOnlyNode,
  type RepositoryNode,
  START_NODE_ID,
  END_NODE_ID,
} from "./nodes.ts";

export {
  type Brand,
  type JsonValue,
  type NonEmptyString,
  type IsoDateTime,
  type Digest,
  type RepoPath,
  type CommitId,
  type RunId,
  type WorkspaceId,
  type PlannedNodeId,
  type GeneratedNodeId,
  type TaskNodeId,
  type Revision,
  type Epoch,
  type AllocationId,
  type AssignmentId,
  type ConflictId,
  type BlockageId,
  type NonZeroExitCode,
  RESERVED_START_NODE_ID,
  RESERVED_END_NODE_ID,
  nonEmptyStringSchema,
  isoDateTimeSchema,
  digestSchema,
  repoPathSchema,
  commitIdSchema,
  runIdSchema,
  workspaceIdSchema,
  revisionSchema,
  epochSchema,
  allocationIdSchema,
  assignmentIdSchema,
  conflictIdSchema,
  blockageIdSchema,
  nonZeroExitCodeSchema,
  plannedNodeIdSchema,
  generatedNodeIdSchema,
  taskIdSchema,
  jsonValueSchema,
} from "./brand.ts";

// fenced assignment / 統合 journal / 成果物 / blockage
export {
  type AssignmentFence,
  type ReadOnlyWorkerAssignment,
  type RepositoryWorkerAssignment,
  type IntegratorAssignment,
  type WorkerAssignment,
  assignmentFenceSchema,
  fenceOf,
  sameFence,
} from "./assignment.ts";

export {
  type SuccessfulCheck,
  type FailedCheck,
  type IntegrationProgress,
  type IntegrationJournal,
  integrationJournalSchema,
  type GitObservation,
} from "./integration.ts";

export {
  type WorkReport,
  type Candidate,
  type ReadOnlyResult,
  type IntegratedRepositoryResult,
  type ConflictResolvedRepositoryResult,
  type RepositoryResult,
} from "./work.ts";

export {
  type ConflictDescriptor,
  type RepositoryOrigin,
  type ExecutionBlockage,
  type IntegrationBlockage,
  type BlockedSnapshot,
  type ResolutionRecord,
} from "./blockage.ts";

// 永続化とスキーマ
export { GRAPH_FILE_RELATIVE_PATH, readSessionActive } from "./persisted-graph.ts";
export { parseGraph } from "./graph-schema.ts";

// 不変条件
export { type InvariantViolation, findInvariantViolations } from "./invariants.ts";
export {
  GraphInvariantViolationError,
  AllocationExhaustedError,
  RevisionOverflowError,
} from "./transaction.ts";

// ready 選択（遷移は operations 側の責務。§3）
export { selectReadyNodes, InvalidReadyLimitError } from "./ready.ts";

// 構造操作（ramune_apply_ops の操作列）
export {
  type InsertNodeOperation,
  type InsertNodePreconditionViolation,
  insertNode,
  InsertNodePreconditionError,
} from "./operations/insert-node.ts";

export {
  type InsertParallelNodeOperation,
  type InsertParallelNodePreconditionViolation,
  insertParallelNode,
  InsertParallelNodePreconditionError,
} from "./operations/insert-parallel-node.ts";

export {
  type ReopenOperation,
  type ReopenPreconditionViolation,
  reopen,
  ReopenPreconditionError,
} from "./operations/reopen.ts";

export {
  type AbortOperation,
  type AbortPreconditionViolation,
  abort,
  AbortPreconditionError,
} from "./operations/abort.ts";

// セッション操作（ramune_start / ramune_end）
export {
  INITIAL_EPOCH,
  type StartSessionOperation,
  type StartSessionPreconditionViolation,
  startSession,
  StartSessionPreconditionError,
} from "./operations/start-session.ts";

export {
  type EndSessionOperation,
  type EndSessionPreconditionViolation,
  endSession,
  EndSessionPreconditionError,
} from "./operations/end-session.ts";

// 実行ライフサイクル操作
export {
  type WorkspaceAllocation,
  type ClaimReadyOperation,
  type ClaimReadyResult,
  type ClaimReadyPreconditionViolation,
  claimReady,
  ClaimReadyPreconditionError,
} from "./operations/claim-ready.ts";

export {
  type RecordResultOperation,
  type RecordResultPreconditionViolation,
  recordResult,
  RecordResultPreconditionError,
} from "./operations/record-result.ts";

export {
  type SubmitCandidateOperation,
  type SubmitCandidatePreconditionViolation,
  submitCandidate,
  SubmitCandidatePreconditionError,
} from "./operations/submit-candidate.ts";

export {
  type ClaimIntegrationOperation,
  type ClaimIntegrationResult,
  type ClaimIntegrationPreconditionViolation,
  claimIntegration,
  ClaimIntegrationPreconditionError,
} from "./operations/claim-integration.ts";

export {
  type AdvanceIntegrationProgress,
  type AdvanceIntegrationOperation,
  type AdvanceIntegrationPreconditionViolation,
  advanceIntegration,
  AdvanceIntegrationPreconditionError,
} from "./operations/advance-integration.ts";

export {
  type RecordIntegrationOutcomeOperation,
  type RecordIntegrationOutcomePreconditionViolation,
  recordIntegrationOutcome,
  RecordIntegrationOutcomePreconditionError,
} from "./operations/record-integration-outcome.ts";

export {
  type RequestReplanOperation,
  type RequestReplanPreconditionViolation,
  requestReplan,
  RequestReplanPreconditionError,
} from "./operations/request-replan.ts";

export {
  type AbandonAssignmentOperation,
  type AbandonAssignmentPreconditionViolation,
  abandonAssignment,
  AbandonAssignmentPreconditionError,
} from "./operations/abandon-assignment.ts";

export {
  type ResumeSessionOperation,
  type ResumeSessionPreconditionViolation,
  resumeSession,
  ResumeSessionPreconditionError,
} from "./operations/resume-session.ts";
export { EpochOverflowError } from "./operations/epoch-overflow-error.ts";

// 操作列の適用
export { type GraphOperation, applyOperations } from "./apply.ts";
