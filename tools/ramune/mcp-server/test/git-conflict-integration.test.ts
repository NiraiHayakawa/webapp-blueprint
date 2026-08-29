// 実 git リポジトリ fixture 上での conflict 経路（設計正本 §6.3）。
// 両側変更により実際の merge conflict が起きること、cleanup 証跡付きで conflict を
// 記録すると解消ノード R が機械挿入されること、R を通常の repository_change ノード
// として完遂すると R と C（解消 chain）が同時に done になることを通しで検証する。
// conflict 検出・記録・機械挿入の検証そのものは git-integration-support.ts に置く
// （複数の conflict シナリオから再利用する harness のため）。
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callToolJson, connectTestClient, type TestClientHandle } from "./connect-test-client.ts";
import { revParseHead } from "@webapp-blueprint/ramune-git/test-support";
import { asRepositoryChange, claimReadyNodes, requireNode } from "./git-integration-support.ts";
import {
  detectAndRecordConflict,
  expectBlockedOnIntegrationConflict,
  type BlockedConflictInfo,
} from "./git-conflict-support.ts";
import {
  createScenarioRoots,
  disposeScenarioRoots,
  reclaimAll,
  runCandidateToEnd,
  runWorkerCandidate,
  type ScenarioRoots,
} from "./git-repo-steps.ts";
import { GOAL, insertTask, readGraph } from "./support.ts";

/** ramune_start してから、鎖状に依存する c1 → c2 の 2 ノードを挿入する。 */
async function setUpConflictGraph(handle: TestClientHandle): Promise<void> {
  await callToolJson(handle, "ramune_start", { goal: GOAL });
  await insertTask(handle, "c1");
  await insertTask(handle, "c2", { from: "c1", to: "end" });
}

/** phase 1: c1 を通常どおり統合まで完遂し、c2 を古い base_commit のまま claim する。 */
async function resolveC1AndClaimStaleC2(
  handle: TestClientHandle,
  repositoryRoot: string,
): Promise<{
  readonly first: Awaited<ReturnType<typeof runCandidateToEnd>>;
  readonly stale: ReturnType<typeof asRepositoryChange>;
}> {
  const head0 = revParseHead(repositoryRoot);

  // c1: README の変更を通常どおり統合まで完遂し、canonical HEAD を動かす。
  const first = await runCandidateToEnd({
    handle,
    repositoryRoot,
    baseCommit: head0,
    spec: { relativePath: "README.md", content: "side A\n", message: "c1" },
    integratorWorkspaceId: "integration-c1",
  });
  expect(first.nodeId).toBe("c1");
  expect(requireNode(first.doneGraph, first.nodeId)?.status).toBe("done");

  // c2: Orchestrator が提示した base_commit が c1 の publish 前の観測（head0）のまま
  // だった状況を再現する。candidate は古い base から分岐し、canonical は既に動いている。
  const claimed = await claimReadyNodes(handle, 1, head0);
  const stale = asRepositoryChange(claimed[0]);
  expect(stale.nodeId).toBe("c2");
  return { first, stale };
}

/** phase 2: 古い base から candidate を作り、conflict を検出・記録する。 */
async function submitStaleCandidateAndDetectConflict(input: {
  readonly handle: TestClientHandle;
  readonly repositoryRoot: string;
  readonly stale: ReturnType<typeof asRepositoryChange>;
  readonly canonicalHead: string;
}): Promise<{ readonly candidateB: string; readonly blockedInfo: BlockedConflictInfo }> {
  const { handle, repositoryRoot, stale, canonicalHead } = input;
  const candidateB = await runWorkerCandidate({
    handle,
    repositoryRoot,
    assignment: stale,
    spec: { relativePath: "README.md", content: "side B\n", message: "c2" },
  });

  const detection = await detectAndRecordConflict(handle, repositoryRoot, {
    candidateCommit: candidateB,
    canonicalHead,
  });
  expect(detection.conflictedFiles).toStrictEqual(["README.md"]);

  // C は blocked(integration_conflict)、R は機械挿入され、相互参照を持つ。
  const blockedInfo = expectBlockedOnIntegrationConflict(detection.conflicted, "c2");
  // candidate は保持される
  expect(blockedInfo.candidateCommit).toBe(candidateB);
  return { candidateB, blockedInfo };
}

/** phase 3: R を通常の repository_change ノードとして完遂し、解消 chain の閉包を見る。 */
async function resolveViaRAndVerify(
  handle: TestClientHandle,
  repositoryRoot: string,
  input: { readonly canonicalHead: string; readonly resolverId: string },
): Promise<Awaited<ReturnType<typeof runCandidateToEnd>>> {
  const resolution = await runCandidateToEnd({
    handle,
    repositoryRoot,
    baseCommit: input.canonicalHead,
    spec: { relativePath: "README.md", content: "side A\nside B\n", message: "衝突を解消" },
    integratorWorkspaceId: "integration-r",
  });
  expect(resolution.nodeId).toBe(input.resolverId);
  expect(revParseHead(repositoryRoot)).toBe(resolution.publishedCommit);
  expect(fs.readFileSync(path.join(repositoryRoot, "README.md"), "utf-8")).toBe("side A\nside B\n");

  // 解消 chain の閉包: R の成功で R と c2 が同時に done になる。
  expect(requireNode(resolution.doneGraph, resolution.nodeId)?.status).toBe("done");
  const afterResolution = await readGraph(handle);
  expect(requireNode(afterResolution, "c2")?.status).toBe("done");
  return resolution;
}

describe("MCP クライアント + ramune-git のパッケージ横断シナリオ: conflict（実 git リポジトリ）", () => {
  let roots: ScenarioRoots;
  let handle: TestClientHandle | undefined;

  beforeEach(async () => {
    roots = await createScenarioRoots("ramune-wp8-conflict-");
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    disposeScenarioRoots(roots.parentDir);
  });

  it("両側変更は実 merge conflict になり、cleanup 証跡付きの記録で R が機械挿入され、R の統合成功で R と C が同時に done になる", async () => {
    expect.hasAssertions();
    const { repositoryRoot } = roots;
    handle = await connectTestClient({ repositoryRoot });
    await setUpConflictGraph(handle);

    const { first, stale } = await resolveC1AndClaimStaleC2(handle, repositoryRoot);
    const { blockedInfo } = await submitStaleCandidateAndDetectConflict({
      handle,
      repositoryRoot,
      stale,
      canonicalHead: first.publishedCommit,
    });
    const resolution = await resolveViaRAndVerify(handle, repositoryRoot, {
      canonicalHead: first.publishedCommit,
      resolverId: blockedInfo.resolverId,
    });

    // 回収と終了。
    await reclaimAll(repositoryRoot, [
      first.workspaceId,
      stale.workspaceId,
      resolution.workspaceId,
      "integration-c1",
      "integration-c2",
      "integration-r",
    ]);
    await callToolJson(handle, "ramune_end", {});
  });
});
