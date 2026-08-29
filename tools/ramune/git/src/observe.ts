// GitObservation の採取（設計正本 §2.4 / §7）。
//
// abandon の照合（§7）と cleanup 証跡（§6.2 / §6.3 の canonicalAfterCleanup）の
// 入力になる観測。canonical と統合 workspace それぞれを clean / dirty /
// merge_in_progress / missing の 4 値で報告する。観測不能な状態（HEAD が解決
// できない等）は 4 値のどれかへ丸めず、型付きエラーで拒否する — 「dirty では
// ないが何かおかしい」状態を dirty へ潰すと、abandon 照合が誤った決定をする。
import path from "node:path";

import { commitIdSchema, type CommitId, type GitObservation } from "@webapp-blueprint/ramune-graph";

import { runGit, runGitOutcome } from "./git-command.ts";
import { GitCommandError } from "./git-command-error.ts";
import { pathExists } from "./fs-support.ts";
import { CanonicalNotCleanError } from "./canonical-not-clean-error.ts";

export class GitObservationError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(
      `Git 状態を観測できませんでした（${reason}）。手動でリポジトリの状態を確認してください。`,
    );
    this.name = "GitObservationError";
    this.reason = reason;
  }
}

export interface ObserveGitInput {
  /** canonical リポジトリのルート。 */
  readonly repositoryRoot: string;
  /** 統合用 worktree のルート。未作成の場合は missing を報告する。 */
  readonly integrationWorktreePath: string;
}

type WorktreeState = "clean" | "dirty" | "merge_in_progress" | "missing";

async function resolveHead(cwd: string): Promise<CommitId> {
  const outcome = await runGitOutcome(cwd, ["rev-parse", "HEAD"]);
  if (outcome.exitCode !== 0) {
    throw new GitObservationError(
      `HEAD を解決できませんでした（${cwd}）: ${outcome.stderr.toString("utf-8").trim()}`,
    );
  }
  return commitIdSchema.parse(outcome.stdout.toString("utf-8").trim());
}

async function worktreeState(worktreePath: string): Promise<WorktreeState> {
  // worktree ルートには git が置いた .git（ファイルまたはディレクトリ）がある。
  // これが無い、または git として解決できないものは missing として扱う。
  if (!(await pathExists(path.join(worktreePath, ".git")))) {
    return "missing";
  }
  const gitDir = await runGitOutcome(worktreePath, ["rev-parse", "--absolute-git-dir"]);
  if (gitDir.exitCode !== 0) {
    return "missing";
  }

  const gitDirPath = gitDir.stdout.toString("utf-8").trim();
  if (await pathExists(path.join(gitDirPath, "MERGE_HEAD"))) {
    return "merge_in_progress";
  }
  const status = await runGit(worktreePath, ["status", "--porcelain"]);
  return status.length > 0 ? "dirty" : "clean";
}

/**
 * canonical と統合 workspace の現在状態を観測する。
 * canonical HEAD の解決に失敗した場合のみエラーになり、それ以外は 4 値で報告する。
 */
export async function observeGit(input: ObserveGitInput): Promise<GitObservation> {
  const { repositoryRoot, integrationWorktreePath } = input;

  let canonicalHead: CommitId;
  try {
    canonicalHead = await resolveHead(repositoryRoot);
  } catch (error) {
    if (error instanceof GitCommandError) {
      throw new GitObservationError(error.message);
    }
    throw error;
  }

  return {
    canonicalHead,
    canonicalWorktree: await worktreeState(repositoryRoot),
    integrationWorkspace: await worktreeState(integrationWorktreePath),
  };
}

export interface CanonicalAfterCleanupEvidence {
  readonly head: CommitId;
  readonly worktree: "clean";
}

/**
 * integration_conflict 記録に必要な証跡（canonicalAfterCleanup）を生成する。
 * canonical が clean 以外の状態なら証跡を作れず型付きエラーになる — Integrator
 * は先に cleanup 義務を果たしていなければならず、未遂のまま証跡だけが揃う
 * ことを構造的に防ぐ（§6.2 / §6.3）。
 */
export async function captureCanonicalAfterCleanup(input: {
  repositoryRoot: string;
}): Promise<CanonicalAfterCleanupEvidence> {
  const { repositoryRoot } = input;

  const head = await resolveHead(repositoryRoot);
  const state = await worktreeState(repositoryRoot);
  if (state !== "clean") {
    throw new CanonicalNotCleanError(state);
  }
  return { head, worktree: "clean" };
}
