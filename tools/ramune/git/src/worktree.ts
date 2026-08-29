// 隔離 worktree の割当と回収（設計正本 §6.1 / §7）。
//
// workspaceId は graph パッケージの allocator が発番した値であり、ここでは
// 「その ID に対応する worktree を git の機構で用意する / 片付ける」だけを責務と
// する。配置は canonical リポジトリ直下の `.ramune/workspaces/<workspaceId>`
// （.ramune/ はリポジトリの .gitignore 対象であり、worktree を置いても
// git status を汚さない）。ブランチも ID から一意に導出するため、割当と回収が
// 文字列の取り決めなしに対応する。
import fs from "node:fs/promises";
import path from "node:path";

import type { CommitId, WorkspaceId } from "@webapp-blueprint/ramune-graph";

import { commitExists, runGit } from "./git-command.ts";
import { pathExists } from "./fs-support.ts";

/** 隔離 worktree の配置規約（canonical リポジトリルートからの相対パス）。 */
export const WORKSPACES_RELATIVE_DIR = ".ramune/workspaces";

export type WorktreeViolation =
  | { reason: "unknown_base_commit"; baseCommit: CommitId }
  | { reason: "already_allocated"; workspaceId: WorkspaceId }
  | { reason: "not_allocated"; workspaceId: WorkspaceId };

export class WorktreePreconditionError extends Error {
  readonly violation: WorktreeViolation;

  constructor(violation: WorktreeViolation) {
    super(`worktree 操作の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "WorktreePreconditionError";
    this.violation = violation;
  }
}

export interface AllocateWorkspaceInput {
  /** canonical リポジトリのルート。 */
  readonly repositoryRoot: string;
  /** graph パッケージの allocator が発番した隔離 worktree の ID。 */
  readonly workspaceId: WorkspaceId;
  /** worktree の起点コミット（claim 時点の canonical HEAD 等）。 */
  readonly baseCommit: CommitId;
}

export interface AllocatedWorkspace {
  readonly path: string;
  readonly branch: string;
}

/** workspaceId に対応する worktree の配置パス。 */
export function workspacePath(repositoryRoot: string, workspaceId: WorkspaceId): string {
  return path.join(repositoryRoot, ...WORKSPACES_RELATIVE_DIR.split("/"), workspaceId);
}

/** workspaceId に対応する専用ブランチ名。 */
export function workspaceBranchName(workspaceId: WorkspaceId): string {
  return `ramune/workspace/${workspaceId}`;
}

async function branchExists(repositoryRoot: string, branch: string): Promise<boolean> {
  return await commitExists(repositoryRoot, `refs/heads/${branch}`);
}

/**
 * 隔離 worktree を作る。baseCommit が解決できない場合と、同一 workspaceId の
 * 再割当（worktree または専用ブランチが既にある）は型付きエラーで拒否する。
 * allocator は ID を再利用しないため、再割当は呼び出し側のバグか二重 claim の兆候である。
 */
export async function allocateWorkspace(
  input: AllocateWorkspaceInput,
): Promise<AllocatedWorkspace> {
  const { repositoryRoot, workspaceId, baseCommit } = input;

  if (!(await commitExists(repositoryRoot, baseCommit))) {
    throw new WorktreePreconditionError({ reason: "unknown_base_commit", baseCommit });
  }

  const targetPath = workspacePath(repositoryRoot, workspaceId);
  const branch = workspaceBranchName(workspaceId);
  if ((await pathExists(targetPath)) || (await branchExists(repositoryRoot, branch))) {
    throw new WorktreePreconditionError({ reason: "already_allocated", workspaceId });
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  // worktree 作成自体に失敗した場合（フックされた git、権限等）は
  // GitCommandError のまま伝播させる。
  await runGit(repositoryRoot, ["worktree", "add", "-b", branch, targetPath, baseCommit]);

  return { path: targetPath, branch };
}

interface WorkspacePresence {
  readonly worktree: boolean;
  readonly branch: boolean;
}

async function workspacePresence(
  repositoryRoot: string,
  workspaceId: WorkspaceId,
): Promise<WorkspacePresence> {
  return {
    worktree: await pathExists(workspacePath(repositoryRoot, workspaceId)),
    branch: await branchExists(repositoryRoot, workspaceBranchName(workspaceId)),
  };
}

async function removeWorkspaceParts(
  repositoryRoot: string,
  workspaceId: WorkspaceId,
  presence: WorkspacePresence,
): Promise<void> {
  if (presence.worktree) {
    await runGit(repositoryRoot, [
      "worktree",
      "remove",
      "--force",
      workspacePath(repositoryRoot, workspaceId),
    ]);
  }
  if (presence.branch) {
    await runGit(repositoryRoot, ["branch", "-D", workspaceBranchName(workspaceId)]);
  }
}

/**
 * done / abort 後の回収。worktree と専用ブランチを取り除く。
 * 未割当の ID に対する回収は「回収漏れを黙って成功させない」ため拒否する
 * （docs/principles/fail-fast.md）。
 */
export async function reclaimWorkspace(input: {
  repositoryRoot: string;
  workspaceId: WorkspaceId;
}): Promise<void> {
  const { repositoryRoot, workspaceId } = input;
  const presence = await workspacePresence(repositoryRoot, workspaceId);
  if (!presence.worktree && !presence.branch) {
    throw new WorktreePreconditionError({ reason: "not_allocated", workspaceId });
  }
  await removeWorkspaceParts(repositoryRoot, workspaceId, presence);
}
