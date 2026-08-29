// 統合用 worktree での candidate merge（設計正本 §6.2 step 2）。
//
// Integrator は canonical ではなく自分の統合用 worktree で candidate を merge
// する。merge は --no-ff で行い、candidate が fast-forward 可能な位置でも
// 統合コミット（integratedCommit）を明示的に作る。これにより journal の
// merge_prepared / publish_prepared が「どの統合結果を検証したか」を常に
// 特定のコミット SHA で指せる。
//
// merge conflict はこの工程の正常系の一部である（§6.3）。競合は例外として
// 抜けず、MergeConflictError に競合ファイル一覧を載せて返す。worktree は
// conflict 状態（merge_in_progress）のままにしておき、後続の cleanup
// （cleanupFailedIntegration）と GitObservation の観測対象になる。
import { commitIdSchema, repoPathSchema } from "@webapp-blueprint/ramune-graph";
import type { CommitId, RepoPath } from "@webapp-blueprint/ramune-graph";

import { commitExists, runGit, runGitOutcome } from "./git-command.ts";
import { GitCommandError } from "./git-command-error.ts";
import { pathExists } from "./fs-support.ts";
import { IntegrationWorkspaceNotCleanError } from "./integration-workspace-not-clean-error.ts";
import { UnknownCandidateCommitError } from "./unknown-candidate-commit-error.ts";
import { MergeConflictError } from "./merge-conflict-error.ts";

export interface PrepareIntegrationMergeInput {
  /** 統合用 worktree のルート（allocateWorkspace の戻り値の path）。 */
  readonly integrationWorktreePath: string;
  /** Worker が提出した candidate のコミット。 */
  readonly candidateCommit: CommitId;
}

export interface PreparedIntegrationMerge {
  /** 統合コミット。journal の merge_prepared 以降がこの値を記録する。 */
  readonly integratedCommit: CommitId;
}

const MERGE_ARGS = ["merge", "--no-ff", "--no-edit"] as const;

async function assertMergeable(
  integrationWorktreePath: string,
  candidateCommit: CommitId,
): Promise<void> {
  if (!(await pathExists(integrationWorktreePath))) {
    throw new IntegrationWorkspaceNotCleanError(integrationWorktreePath);
  }
  const status = await runGit(integrationWorktreePath, ["status", "--porcelain"]);
  if (status.length > 0) {
    throw new IntegrationWorkspaceNotCleanError(integrationWorktreePath);
  }
  if (!(await commitExists(integrationWorktreePath, candidateCommit))) {
    throw new UnknownCandidateCommitError(candidateCommit);
  }
}

async function isMergeInProgress(worktreePath: string): Promise<boolean> {
  const outcome = await runGitOutcome(worktreePath, [
    "rev-parse",
    "--verify",
    "--quiet",
    "MERGE_HEAD",
  ]);
  return outcome.exitCode === 0;
}

async function conflictedFilesOf(worktreePath: string): Promise<readonly RepoPath[]> {
  const listing = await runGit(worktreePath, ["diff", "--name-only", "--diff-filter=U"]);
  return listing
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => repoPathSchema.parse(line));
}

/** merge を実行する。conflict は worktree をその状態のまま MergeConflictError へ変換する。 */
async function mergeOrThrowConflict(
  integrationWorktreePath: string,
  candidateCommit: CommitId,
): Promise<void> {
  const args = [...MERGE_ARGS, candidateCommit];
  const outcome = await runGitOutcome(integrationWorktreePath, args);

  if (outcome.exitCode === 0) {
    return;
  }
  if (await isMergeInProgress(integrationWorktreePath)) {
    throw new MergeConflictError(await conflictedFilesOf(integrationWorktreePath));
  }
  throw new GitCommandError({
    args,
    exitCode: outcome.exitCode,
    stderrText: outcome.stderr.toString("utf-8"),
  });
}

/**
 * candidate を統合用 worktree へ merge し、統合コミットを返す。
 * 前提条件（worktree が存在し clean、candidate が解決できる）を満たさない場合は
 * 型付きエラーで拒否する。conflict は merge_in_progress のまま返す（cleanup は
 * 呼び出し側が明示的に行う。自動復旧を作らない）。
 */
export async function prepareIntegrationMerge(
  input: PrepareIntegrationMergeInput,
): Promise<PreparedIntegrationMerge> {
  const { integrationWorktreePath, candidateCommit } = input;

  await assertMergeable(integrationWorktreePath, candidateCommit);
  await mergeOrThrowConflict(integrationWorktreePath, candidateCommit);

  const head = await runGit(integrationWorktreePath, ["rev-parse", "HEAD"]);
  return { integratedCommit: commitIdSchema.parse(head) };
}
