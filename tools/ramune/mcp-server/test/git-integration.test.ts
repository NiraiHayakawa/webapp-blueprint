// 実 git リポジトリ fixture 上で MCP クライアントと @webapp-blueprint/ramune-git を
// 組み合わせた happy path の統合シナリオ（設計正本 §6.1 / §6.2 / §6.4）。
// claim_ready の実割当（worktree 実在）から candidate 実コミット、merge / 1 コマンド
// 検証 / canonical publish、record_integration_outcome(success) → done → 回収 →
// ramune_end までを通す。conflict 経路は git-conflict-integration.test.ts。
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workspaceIdSchema, type GraphV2 } from "@webapp-blueprint/ramune-graph";
import { workspacePath } from "@webapp-blueprint/ramune-git";

import { callToolJson, connectTestClient, type TestClientHandle } from "./connect-test-client.ts";
import { revParseHead } from "@webapp-blueprint/ramune-git/test-support";
import {
  asRepositoryChange,
  claimReadyNodes,
  integrateCandidate,
  recordIntegrationSuccess,
  requireNode,
  type IntegrationRunResult,
} from "./git-integration-support.ts";
import {
  assertWorktreeRemoved,
  createScenarioRoots,
  disposeScenarioRoots,
  reclaimAll,
  runWorkerCandidate,
  type ScenarioRoots,
} from "./git-repo-steps.ts";
import { GOAL, insertTask, readGraph } from "./support.ts";

/** claim_ready が返した worker fence が期待どおりかを見る。 */
function assertWorkerAssignment(
  worker: { readonly nodeId: string; readonly baseCommit: string; readonly workspaceId?: string },
  headBefore: string,
): void {
  expect(worker.nodeId).toBe("t1");
  expect(worker.baseCommit).toBe(headBefore);
  expect(worker.workspaceId).toMatch(/^ws-/u);
}

/** Worker の隔離 worktree に、既存ファイルと新規ファイルの両方が実在することを見る。 */
function assertWorkerFilesWritten(workerPath: string): void {
  expect(fs.readFileSync(path.join(workerPath, "README.md"), "utf-8")).toBe("# test repo\n");
  expect(fs.readFileSync(path.join(workerPath, "feature.txt"), "utf-8")).toBe("worker output\n");
}

/** source はサーバーが current assignment からコピーする（Worker の申告ではない）。 */
function assertSubmittedWithServerCopiedSource(
  graph: GraphV2,
  expected: {
    readonly workspaceId: string;
    readonly baseCommit: string;
    readonly candidateCommit: string;
  },
): void {
  const submitted = requireNode(graph, "t1");
  expect(submitted.status).toBe("awaiting_integration");
  if (
    submitted.kind !== "task" ||
    submitted.effect !== "repository_change" ||
    submitted.status !== "awaiting_integration"
  ) {
    throw new Error("t1 は awaiting_integration な repository_change task のはず");
  }
  expect(submitted.candidate.commit).toBe(expected.candidateCommit);
  expect(submitted.candidate.source.workspaceId).toBe(expected.workspaceId);
  expect(submitted.candidate.source.baseCommit).toBe(expected.baseCommit);
}

/** --no-ff の統合コミットが canonical へ実際に反映されていることを見る。 */
function assertPublishedToCanonical(
  repositoryRoot: string,
  run: IntegrationRunResult,
  candidateCommit: string,
): void {
  expect(run.publishedCommit).not.toBe(candidateCommit);
  expect(revParseHead(repositoryRoot)).toBe(run.publishedCommit);
  expect(fs.readFileSync(path.join(repositoryRoot, "feature.txt"), "utf-8")).toBe(
    "worker output\n",
  );
}

function requireDoneRepositoryTask(graph: GraphV2) {
  const finished = requireNode(graph, "t1");
  expect(finished.status).toBe("done");
  if (
    finished.kind !== "task" ||
    finished.effect !== "repository_change" ||
    finished.status !== "done"
  ) {
    throw new Error("t1 は done な repository_change task のはず");
  }
  return finished;
}

function assertIntegratedVerification(
  result: {
    readonly integratedCommit: string;
    readonly verification: { readonly command: string; readonly exitCode: number };
  },
  publishedCommit: string,
): void {
  expect(result.integratedCommit).toBe(publishedCommit);
  expect(result.verification.command).toBe("mise run check");
  expect(result.verification.exitCode).toBe(0);
}

function assertDoneWithIntegratedEvidence(
  graph: GraphV2,
  publishedCommit: string,
  candidateCommit: string,
): void {
  const finished = requireDoneRepositoryTask(graph);
  expect(finished.result.kind).toBe("integrated");
  if (finished.result.kind !== "integrated") {
    throw new Error("t1 の結果は integrated のはず");
  }
  assertIntegratedVerification(finished.result, publishedCommit);
  // done でも candidate は保持される（§2.7）。
  expect(finished.candidate.commit).toBe(candidateCommit);
}

/** phase 1: ramune_start + t1 挿入 + claim_ready の worker fence 検証。 */
async function startAndClaimWorker(
  handle: TestClientHandle,
  repositoryRoot: string,
): Promise<{ readonly worker: ReturnType<typeof asRepositoryChange>; readonly head0: string }> {
  await callToolJson(handle, "ramune_start", { goal: GOAL });
  await insertTask(handle, "t1");

  const head0 = revParseHead(repositoryRoot);
  const claimed = await claimReadyNodes(handle, 1, head0);
  const worker = asRepositoryChange(claimed[0]);
  assertWorkerAssignment(worker, head0);
  return { worker, head0 };
}

/**
 * phase 2: Worker 相当。自分の worktree だけで編集し candidate commit を作って提出する。
 * ramune-git が graph の発番した workspaceId の場所へ worktree を実際に用意したことの
 * 確認を兼ね、配置規約の path から作業結果を読む。
 */
async function runWorkerAndSubmit(input: {
  readonly handle: TestClientHandle;
  readonly repositoryRoot: string;
  readonly worker: ReturnType<typeof asRepositoryChange>;
  readonly head0: string;
}): Promise<string> {
  const { handle, repositoryRoot, worker, head0 } = input;
  const candidateCommit = await runWorkerCandidate({
    handle,
    repositoryRoot,
    assignment: worker,
    spec: {
      relativePath: "feature.txt",
      content: "worker output\n",
      message: "t1",
    },
  });
  const workerPath = workspacePath(repositoryRoot, workspaceIdSchema.parse(worker.workspaceId));
  assertWorkerFilesWritten(workerPath);

  assertSubmittedWithServerCopiedSource(await readGraph(handle), {
    workspaceId: worker.workspaceId,
    baseCommit: head0,
    candidateCommit,
  });
  return candidateCommit;
}

/** phase 4: success を記録し、done 後の回収（§6.1 / §7）まで進める。 */
async function recordSuccessAndReclaim(input: {
  readonly handle: TestClientHandle;
  readonly repositoryRoot: string;
  readonly run: IntegrationRunResult;
  readonly candidateCommit: string;
  readonly worker: ReturnType<typeof asRepositoryChange>;
}): Promise<void> {
  const { handle, repositoryRoot, run, candidateCommit, worker } = input;
  const done = await recordIntegrationSuccess(handle, run.integratorFence);
  assertDoneWithIntegratedEvidence(done, run.publishedCommit, candidateCommit);

  // worktree と専用ブランチが取り除かれる。
  await reclaimAll(repositoryRoot, [worker.workspaceId, "integration-t1"]);
  assertWorktreeRemoved(repositoryRoot, worker.workspaceId);
}

/** phase 3: 統合用 worktree で merge / 1 コマンド検証 / canonical publish を経て発行する。 */
async function integrateAndPublish(input: {
  readonly handle: TestClientHandle;
  readonly repositoryRoot: string;
  readonly candidateCommit: string;
  readonly head0: string;
}): Promise<IntegrationRunResult> {
  const { handle, repositoryRoot, candidateCommit, head0 } = input;
  const run = await integrateCandidate({
    handle,
    repositoryRoot,
    candidateCommit,
    canonicalHeadBefore: head0,
    integratorWorkspaceId: "integration-t1",
  });
  assertPublishedToCanonical(repositoryRoot, run, candidateCommit);
  return run;
}

describe("MCP クライアント + ramune-git のパッケージ横断シナリオ（実 git リポジトリ）", () => {
  let roots: ScenarioRoots;
  let handle: TestClientHandle | undefined;

  beforeEach(async () => {
    roots = await createScenarioRoots("ramune-wp8-happy-");
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    disposeScenarioRoots(roots.parentDir);
  });

  it("claim_ready の実割当から candidate 実コミット、merge / 検証 / publish を経て done になり ramune_end まで通る", async () => {
    expect.hasAssertions();
    const { repositoryRoot } = roots;
    handle = await connectTestClient({ repositoryRoot });

    const { worker, head0 } = await startAndClaimWorker(handle, repositoryRoot);
    const candidateCommit = await runWorkerAndSubmit({ handle, repositoryRoot, worker, head0 });
    const run = await integrateAndPublish({ handle, repositoryRoot, candidateCommit, head0 });
    await recordSuccessAndReclaim({ handle, repositoryRoot, run, candidateCommit, worker });

    await callToolJson(handle, "ramune_end", {});
  });
});
