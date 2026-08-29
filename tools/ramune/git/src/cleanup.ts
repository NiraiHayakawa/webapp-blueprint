// 失敗経路の cleanup（設計正本 §6.2）。
//
// いずれの失敗経路でも、Integrator は canonical と統合用 worktree を clean に
// 戻してから結果を記録する。このモジュールは統合用 worktree 側の復元
// （merge 中断、index / MERGE_HEAD の解消、作業ツリーのリセット）を担い、
// canonical 側の証跡（canonicalAfterCleanup）の生成は captureCanonicalAfterCleanup
// が行う。「戻せた」ことの確認までを含め、確認できない状態を成功扱いにしない。
import { runGit, runGitOutcome } from "./git-command.ts";
import { pathExists } from "./fs-support.ts";

export class CleanupIncompleteError extends Error {
  readonly integrationWorktreePath: string;

  constructor(integrationWorktreePath: string, reason: string) {
    super(
      `統合用 worktree の cleanup を完了できません（${integrationWorktreePath}）: ${reason}` +
        "手動で状態を確認した上で、失敗経路の記録は行わないでください。",
    );
    this.name = "CleanupIncompleteError";
    this.integrationWorktreePath = integrationWorktreePath;
  }
}

export interface CleanupIntegrationInput {
  readonly integrationWorktreePath: string;
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

/**
 * 統合用 worktree を pre-merge の clean 状態へ戻す。
 * merge 中でなければ何もせず成功する（既に clean なことの確認を兼ねる）。
 * 最後に status --porcelain が空であることを検査し、空でなければ型付きエラー。
 */
export async function cleanupFailedIntegration(input: CleanupIntegrationInput): Promise<void> {
  const { integrationWorktreePath } = input;

  if (!(await pathExists(integrationWorktreePath))) {
    throw new CleanupIncompleteError(integrationWorktreePath, "worktree が存在しません");
  }

  if (await isMergeInProgress(integrationWorktreePath)) {
    await runGit(integrationWorktreePath, ["merge", "--abort"]);
  }
  await runGit(integrationWorktreePath, ["reset", "--hard", "HEAD"]);
  await runGit(integrationWorktreePath, ["clean", "-fd"]);

  const remainingStatus = await runGit(integrationWorktreePath, ["status", "--porcelain"]);
  if (remainingStatus.length > 0) {
    throw new CleanupIncompleteError(
      integrationWorktreePath,
      `cleanup 後も未コミットの変更が残っています（${remainingStatus.split("\n").length} 行目以上の差分）`,
    );
  }
}
