// git-integration テスト群（実 git リポジトリ fixture × MCP クライアント × ramune-git）
// で共有する harness のうち、MCP クライアント経由の工程を担う部分。実 git 側の
// 土台と Worker 工程（§6.1）は git-repo-steps.ts。公開契約（MCP ツール応答と
// ramune-git の公開 API）だけを扱い、シナリオ本体はこの harness の手順の並べ方だけで
// 表現する。
import {
  assignmentFenceSchema,
  commitIdSchema,
  findNode,
  integrationJournalSchema,
  workspaceIdSchema,
  type GraphNode,
  type GraphV2,
} from "@webapp-blueprint/ramune-graph";
import {
  allocateWorkspace,
  prepareIntegrationMerge,
  publishCandidate,
  runVerification,
} from "@webapp-blueprint/ramune-git";

import { callToolJson, type TestClientHandle } from "./connect-test-client.ts";
import type { AssignmentWire } from "./support.ts";
import { readGraph, toWireFence } from "./support.ts";

/**
 * claim_ready 応答の assignment のうち、repository_change として確定した形。
 * ワイヤでは省略可能な workspaceId / baseCommit が、この効果では必ず入る。
 */
export type RepositoryChangeAssignment = AssignmentWire & {
  readonly effect: "repository_change";
  readonly workspaceId: string;
  readonly baseCommit: string;
};

export interface ClaimIntegrationWire {
  readonly journal: {
    readonly assignment: {
      readonly id: number;
      readonly nodeId: string;
      readonly runId: string;
      readonly epoch: number;
    };
    readonly candidateCommit: string;
    readonly canonicalHeadBefore: string;
    readonly progress: { readonly stage: string };
  };
}

export interface IntegrationRunResult {
  readonly publishedCommit: string;
  readonly integratorFence: ReturnType<typeof toWireFence>;
}

export function requireNode(graph: GraphV2, id: string): GraphNode {
  const node = findNode(graph, id);
  if (node === undefined) {
    throw new Error(`ノード ${id} が存在しない`);
  }
  return node;
}

/** claim_ready 応答から repository_change の assignment を取り出す（省略値は契約違反）。 */
export function asRepositoryChange(
  assignment: AssignmentWire | undefined,
): RepositoryChangeAssignment {
  if (
    assignment === undefined ||
    assignment.effect !== "repository_change" ||
    assignment.workspaceId === undefined ||
    assignment.baseCommit === undefined
  ) {
    throw new Error("repository_change の assignment を取得できなかった");
  }
  return {
    ...assignment,
    effect: "repository_change",
    workspaceId: assignment.workspaceId,
    baseCommit: assignment.baseCommit,
  };
}

export async function claimReadyNodes(
  handle: TestClientHandle,
  limit: number,
  baseCommit: string,
): Promise<readonly AssignmentWire[]> {
  const current = await readGraph(handle);
  const claimed = await callToolJson<{
    readonly assignments: readonly AssignmentWire[];
  }>(handle, "ramune_claim_ready", {
    expected_revision: current.revision,
    limit,
    base_commit: baseCommit,
  });
  return claimed.assignments;
}

export async function submitCandidate(
  handle: TestClientHandle,
  assignment: RepositoryChangeAssignment,
  commit: string,
): Promise<void> {
  await callToolJson(handle, "ramune_submit_candidate", {
    fence: toWireFence(assignment),
    commit,
    report: { summary: `${assignment.nodeId} の候補`, data: null },
  });
}

interface IntegrateCandidateInput {
  readonly handle: TestClientHandle;
  readonly repositoryRoot: string;
  readonly candidateCommit: string;
  readonly canonicalHeadBefore: string;
  readonly integratorWorkspaceId: string;
}

/** §6.2 step 1: claim_integration し、journal が期待どおり始まっていることを確かめる。 */
async function claimIntegrationJournal(
  input: IntegrateCandidateInput,
): Promise<ClaimIntegrationWire> {
  const beforeClaim = await readGraph(input.handle);
  const claimed = await callToolJson<ClaimIntegrationWire>(
    input.handle,
    "ramune_claim_integration",
    {
      expected_revision: beforeClaim.revision,
      canonical_head_before: input.canonicalHeadBefore,
    },
  );
  if (claimed.journal.progress.stage !== "claimed") {
    throw new Error("journal が claimed から始まっていない");
  }
  if (claimed.journal.candidateCommit !== input.candidateCommit) {
    throw new Error("journal の candidate が提出と一致しない");
  }
  return claimed;
}

/**
 * §6.2 step 2-3: 統合用 worktree で merge（--no-ff）してから 1 コマンド検証を通し、
 * journal を merge_prepared → publish_prepared まで前進させる。
 */
async function mergeVerifyAndAdvance(
  input: IntegrateCandidateInput,
  claimed: ClaimIntegrationWire,
): Promise<{
  readonly integratedCommit: string;
  readonly integratorFence: ReturnType<typeof toWireFence>;
}> {
  const integratorWorkspace = await allocateWorkspace({
    repositoryRoot: input.repositoryRoot,
    workspaceId: workspaceIdSchema.parse(input.integratorWorkspaceId),
    baseCommit: commitIdSchema.parse(input.canonicalHeadBefore),
  });
  const merged = await prepareIntegrationMerge({
    integrationWorktreePath: integratorWorkspace.path,
    candidateCommit: commitIdSchema.parse(input.candidateCommit),
  });

  const integratorFence = toWireFence(claimed.journal.assignment);
  await callToolJson(input.handle, "ramune_advance_integration", {
    fence: integratorFence,
    progress: { stage: "merge_prepared", integrated_commit: merged.integratedCommit },
  });

  // 既定の mise run check の代わりに軽量な git コマンドを注入して機構を実走させる
  // （verify.ts に明記されたテスト用の差し替え経路）。
  const measurement = await runVerification({
    cwd: integratorWorkspace.path,
    checkedCommit: merged.integratedCommit,
    command: ["git", "cat-file", "-e", `${merged.integratedCommit}^{commit}`],
  });
  if (measurement.exitCode !== 0) {
    throw new Error("注入した検証コマンドが失敗した");
  }

  await callToolJson(input.handle, "ramune_advance_integration", {
    fence: integratorFence,
    progress: {
      stage: "publish_prepared",
      integrated_commit: merged.integratedCommit,
      verification: {
        checked_commit: merged.integratedCommit,
        output_digest: measurement.outputDigest,
        finished_at: measurement.finishedAt,
      },
    },
  });
  return { integratedCommit: merged.integratedCommit, integratorFence };
}

/**
 * §6.2 step 3 → 4: publish_prepared を journal に永続化してから CAS する。
 * publishCandidate に渡す fence は fresh に読み取った現在の assignment から組み立てる
 * （IntegratorAssignment は allocator から Worker とは独立の assignmentId を持つため、
 * Worker の claim 時の値を渡すと fence_mismatch として正しく拒否される）。
 */
async function publishIntegratedCandidate(
  input: IntegrateCandidateInput,
  nodeId: string,
): Promise<string> {
  const prepared = await readGraph(input.handle);
  const node = findNode(prepared, nodeId);
  if (node?.kind !== "task" || node.status !== "integrating") {
    throw new Error("統合対象ノードが integrating になっていない");
  }
  const journal = integrationJournalSchema.parse(node.integration);
  const currentFence = assignmentFenceSchema.parse({
    id: journal.assignment.id,
    nodeId: journal.assignment.nodeId,
    runId: journal.assignment.runId,
    epoch: journal.assignment.epoch,
  });
  const published = await publishCandidate({
    repositoryRoot: input.repositoryRoot,
    journal,
    fence: currentFence,
  });
  return published.publishedCommit;
}

/**
 * §6.2 の Integrator 工程を ramune-git の公開 API で通す:
 * claim_integration → 統合用 worktree で merge → 検証（コマンド注入）→ journal 前進 →
 * publish_prepared の永続化 → canonical への CAS。
 */
export async function integrateCandidate(
  input: IntegrateCandidateInput,
): Promise<IntegrationRunResult> {
  const claimed = await claimIntegrationJournal(input);
  const { integratorFence } = await mergeVerifyAndAdvance(input, claimed);
  const publishedCommit = await publishIntegratedCandidate(
    input,
    claimed.journal.assignment.nodeId,
  );
  return { publishedCommit, integratorFence };
}

export async function recordIntegrationSuccess(
  handle: TestClientHandle,
  integratorFence: IntegrationRunResult["integratorFence"],
): Promise<GraphV2> {
  return await callToolJson<GraphV2>(handle, "ramune_record_integration_outcome", {
    fence: integratorFence,
    outcome: { kind: "success" },
  });
}
