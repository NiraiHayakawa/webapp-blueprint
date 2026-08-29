// git-integration テスト群のうち、実 git リポジトリ側の土台と Worker 工程
// （§6.1）を担うヘルパ。MCP クライアント経由の工程は git-integration-support.ts。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { commitIdSchema, workspaceIdSchema, type GraphV2 } from "@webapp-blueprint/ramune-graph";
import {
  allocateWorkspace,
  reclaimWorkspace,
  type AllocatedWorkspace,
  workspacePath,
} from "@webapp-blueprint/ramune-git";
import {
  commitFile,
  createGitRepo,
  type CommitSpec,
} from "@webapp-blueprint/ramune-git/test-support";

import type { TestClientHandle } from "./connect-test-client.ts";
import type { RepositoryChangeAssignment } from "./git-integration-support.ts";
import {
  asRepositoryChange,
  claimReadyNodes,
  integrateCandidate,
  recordIntegrationSuccess,
  submitCandidate,
} from "./git-integration-support.ts";

/** シナリオごとの作業ディレクトリと、その中に作る実 git リポジトリ。 */
export interface ScenarioRoots {
  readonly parentDir: string;
  readonly repositoryRoot: string;
}

export async function createScenarioRoots(label: string): Promise<ScenarioRoots> {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), label));
  return { parentDir, repositoryRoot: await createGitRepo(parentDir) };
}

export function disposeScenarioRoots(parentDir: string): void {
  fs.rmSync(parentDir, { recursive: true, force: true });
}

/**
 * graph が発番した workspaceId の場所へ、ramune-git に隔離 worktree を用意させる。
 * 割当の実在（path が配置規約どおりであること）は呼び出し側のシナリオが検査する。
 */
async function allocateWorkerWorkspace(
  repositoryRoot: string,
  assignment: RepositoryChangeAssignment,
): Promise<AllocatedWorkspace> {
  return await allocateWorkspace({
    repositoryRoot,
    workspaceId: workspaceIdSchema.parse(assignment.workspaceId),
    baseCommit: commitIdSchema.parse(assignment.baseCommit),
  });
}

/**
 * Worker 工程（§6.1）: 隔離 worktree の割当、ファイル編集と candidate commit、提出。
 * candidate の内容は spec として受け取る（シナリオごとの差分はここに集約される）。
 */
export async function runWorkerCandidate(input: {
  readonly handle: TestClientHandle;
  readonly repositoryRoot: string;
  readonly assignment: RepositoryChangeAssignment;
  readonly spec: CommitSpec;
}): Promise<string> {
  const workspace = await allocateWorkerWorkspace(input.repositoryRoot, input.assignment);
  const candidateCommit = await commitFile(workspace.path, input.spec);
  await submitCandidate(input.handle, input.assignment, candidateCommit);
  return candidateCommit;
}

/**
 * 1 件の repository_change ノードを claim から done まで通す
 * （§6.1 の Worker 工程 → §6.2 / §6.4 の Integrator 工程 → success 記録）。
 * base_commit をそのまま canonical_head_before に使う。統合時点で canonical が
 * claim 時点から動いているシナリオ（conflict 経路）は、この関数を使わずに
 * 各工程を個別に呼ぶ。
 */
export async function runCandidateToEnd(input: {
  readonly handle: TestClientHandle;
  readonly repositoryRoot: string;
  readonly baseCommit: string;
  readonly spec: CommitSpec;
  readonly integratorWorkspaceId: string;
}): Promise<{
  readonly nodeId: string;
  readonly workspaceId: string;
  readonly publishedCommit: string;
  readonly doneGraph: GraphV2;
}> {
  const claimedNodes = await claimReadyNodes(input.handle, 1, input.baseCommit);
  const assignment = asRepositoryChange(claimedNodes[0]);
  const candidateCommit = await runWorkerCandidate({
    handle: input.handle,
    repositoryRoot: input.repositoryRoot,
    assignment,
    spec: input.spec,
  });
  const run = await integrateCandidate({
    handle: input.handle,
    repositoryRoot: input.repositoryRoot,
    candidateCommit,
    canonicalHeadBefore: input.baseCommit,
    integratorWorkspaceId: input.integratorWorkspaceId,
  });
  return {
    nodeId: assignment.nodeId,
    workspaceId: assignment.workspaceId,
    publishedCommit: run.publishedCommit,
    doneGraph: await recordIntegrationSuccess(input.handle, run.integratorFence),
  };
}

/** done 後の回収（§6.1 / §7）。未割当の ID を渡した場合は ramune-git が拒否する。 */
export async function reclaimAll(
  repositoryRoot: string,
  workspaceIds: readonly string[],
): Promise<void> {
  await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      await reclaimWorkspace({ repositoryRoot, workspaceId: workspaceIdSchema.parse(workspaceId) });
    }),
  );
}

/** worktree が回収済み（配置規約の path が存在しない）ことの確認。 */
export function assertWorktreeRemoved(repositoryRoot: string, workspaceId: string): void {
  if (fs.existsSync(workspacePath(repositoryRoot, workspaceIdSchema.parse(workspaceId)))) {
    throw new Error("worktree が回収されていない");
  }
}
