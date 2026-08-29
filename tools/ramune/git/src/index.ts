// tools/ramune/git の公開面。re-export のみ（packages/README.md「公開面の規約」）。
//
// 設計正本 §6（隔離 worktree と直列統合）と §7（回復）を支える Git 機構。
// グラフ状態には触れず、MCP ツールへの配線は WP3 / WP5 が行う。

// 隔離 worktree の割当と回収（§6.1 / §7）
export {
  WorktreePreconditionError,
  allocateWorkspace,
  reclaimWorkspace,
  workspaceBranchName,
  workspacePath,
  WORKSPACES_RELATIVE_DIR,
} from "./worktree.ts";
export type { AllocateWorkspaceInput, AllocatedWorkspace, WorktreeViolation } from "./worktree.ts";

// 統合用 worktree での merge（§6.2 step 2）
export { IntegrationWorkspaceNotCleanError } from "./integration-workspace-not-clean-error.ts";
export { UnknownCandidateCommitError } from "./unknown-candidate-commit-error.ts";
export { MergeConflictError } from "./merge-conflict-error.ts";
export { prepareIntegrationMerge } from "./merge.ts";
export type { PrepareIntegrationMergeInput, PreparedIntegrationMerge } from "./merge.ts";

// 失敗経路の cleanup（§6.2）
export { CleanupIncompleteError, cleanupFailedIntegration } from "./cleanup.ts";
export type { CleanupIntegrationInput } from "./cleanup.ts";

// 1 コマンド検証と証跡生成（§6.2 step 3）
export { VerificationProcessError } from "./verification-process-error.ts";
export { VerificationEvidenceError } from "./verification-evidence-error.ts";
export { DEFAULT_VERIFICATION_COMMAND, miseRunCheckEvidence, runVerification } from "./verify.ts";
export type { RunVerificationInput, VerificationMeasurement } from "./verify.ts";

// canonical publish の単一 authority 経路（§6.4）
export { PublishPreconditionError, publishCandidate } from "./publish.ts";
export type {
  PublishCandidateInput,
  PublishPreconditionViolation,
  PublishedCandidate,
} from "./publish.ts";

// GitObservation の採取（§2.4 / §7）
export { CanonicalNotCleanError } from "./canonical-not-clean-error.ts";
export { GitObservationError, captureCanonicalAfterCleanup, observeGit } from "./observe.ts";
export type { CanonicalAfterCleanupEvidence, ObserveGitInput } from "./observe.ts";

// git CLI 実行の最下層（エラー型のみ公開。実行ヘルパは内部で使う）
export { GitCommandError } from "./git-command-error.ts";
export { ProcessError } from "./process-error.ts";
