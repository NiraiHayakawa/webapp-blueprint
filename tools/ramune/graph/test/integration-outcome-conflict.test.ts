// record_integration_outcome の conflict 経路の公開契約（§6.3）:
// C を blocked(integration_conflict) にして解消ノード R を機械挿入すること、および
// R の統合成功で解消 chain 全体を同時に done にすること。
import { describe, expect, it } from "vitest";
import {
  advanceIntegration,
  claimIntegration,
  claimReady,
  commitIdSchema,
  createGraph,
  digestSchema,
  findNode,
  fenceOf,
  nonEmptyStringSchema,
  recordIntegrationOutcome,
  startSession,
  submitCandidate,
} from "../src/index.ts";
import type { GraphV2, RepoPath } from "../src/index.ts";
import {
  COMMIT_A,
  COMMIT_B,
  type GraphWithFence,
  pendingRepository,
  RUN_ID,
  T0,
  T1,
  WORKSPACE_INTEGRATION,
  WORKSPACE_1,
} from "./test-support.ts";

const SUMMARY = nonEmptyStringSchema.parse("統合した");
const REASON = nonEmptyStringSchema.parse("理由");
const DIGEST = digestSchema.parse("digest");
const CHECKED = commitIdSchema.parse("cccccccccccccccccccccccccccccccccccccccc");
const FILES: readonly RepoPath[] = [];
// conflict 記録 1 回で allocator が進む数（blockage / conflict / 解消ノード R）
const ALLOCATION_IDS_PER_CONFLICT = 3;

/** C が blocked(integration_conflict) へ遷移したこと、R の ID が C.deps へ追記されたことを見る。 */
function expectConflictedC(next: GraphV2): void {
  const c1 = findNode(next, "c1");
  expect(c1?.status).toBe("blocked");
  if (c1?.kind !== "task" || c1.status !== "blocked") {
    return;
  }
  expect(c1.phase).toBe("integration");
  if (c1.blockage.kind !== "integration_conflict") {
    // blockage が違う場合はテスト失敗（unreachable）
    throw new Error(`blockage は integration_conflict であるべき（実際: ${c1.blockage.kind}）`);
  }
  expect(c1.blockage.conflict.targetNodeId).toBe("c1");
  expect(c1.blockage.canonicalAfterCleanup.worktree).toBe("clean");
  // R の ID が C.deps へ追記される
  expect(c1.deps).toContain(c1.blockage.resolutionNodeId);
}

/** R は allocator 発番 ID の pending ノードとして末尾に挿入され、C.resolves 相互参照を持つ。 */
function expectInsertedResolver(next: GraphV2): void {
  const resolver = next.nodes.find((node) => node.id.startsWith("gen-"));
  expect(resolver).toBeDefined();
  if (resolver?.kind !== "task") {
    throw new Error("R は task");
  }
  expect(resolver.effect).toBe("repository_change");
  expect(resolver.purpose).toBe("conflict_resolution");
  if (resolver.purpose !== "conflict_resolution" || resolver.status !== "pending") {
    return;
  }
  expect(resolver.resolves).toBe("c1");
  expect(resolver.deps).toStrictEqual(["start"]);
}

/** R が done になり、完了証跡が自身を resolutionNodeId とする conflict_resolved であることを見る。 */
function expectRDoneAsResolved(closed: GraphV2, resolverId: string): void {
  const r = findNode(closed, resolverId);
  expect(r?.status).toBe("done");
  if (r?.kind !== "task" || r.status !== "done" || r.effect !== "repository_change") {
    return;
  }
  expect(r.result.kind).toBe("conflict_resolved");
  if (r.result.kind !== "conflict_resolved") {
    return;
  }
  expect(r.result.resolutionNodeId).toBe(resolverId);
}

/** C も done になり、candidate が保持されていることを見る。 */
function expectCDoneAsResolved(closed: GraphV2): void {
  const c = findNode(closed, "c1");
  expect(c?.status).toBe("done");
  if (c?.kind !== "task" || c.status !== "done" || c.effect !== "repository_change") {
    return;
  }
  expect(c.result.kind).toBe("conflict_resolved");
  expect(c.candidate.commit).toBe(COMMIT_A);
}

/** 解消対象 C（c1）を candidate 提出まで進め、Integrator が claim_integration した状態。 */
function integratingWithConflictedTask() {
  // 解消対象 C を用意し、その candidate を提出 -> claim_integration まで進める
  const base = createGraph("goal");
  const cNode = pendingRepository("c1", ["start"]);
  const started = startSession(
    { ...base, nodes: [...base.nodes, cNode] },
    {
      type: "start_session",
      runId: RUN_ID,
    },
  );
  const claimedWorker = claimReady(started, {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
    workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
  });
  const [workerFence] = claimedWorker.assignments;
  if (!workerFence) {
    throw new Error("フィクスチャ構築に失敗");
  }
  const awaiting = submitCandidate(claimedWorker.graph, {
    type: "submit_candidate",
    nodeId: "c1",
    fence: workerFence,
    commit: COMMIT_A,
    report: { summary: SUMMARY, data: null },
    submittedAt: T0,
  });
  const claimed = claimIntegration(awaiting, {
    type: "claim_integration",
    workspaceId: WORKSPACE_INTEGRATION,
    startedAt: T0,
    canonicalHeadBefore: COMMIT_B,
  });
  return { graph: claimed.graph, fence: fenceOf(claimed.journal.assignment) };
}

/** integrating 中の C に対して conflict を記録し、R 挿入済みグラフを返す。 */
function insertConflict(setup: GraphWithFence): GraphV2 {
  return recordIntegrationOutcome(setup.graph, {
    type: "record_integration_outcome",
    fence: setup.fence,
    outcome: {
      kind: "conflict",
      reason: REASON,
      title: nonEmptyStringSchema.parse("解消"),
      files: FILES,
      canonicalHeadAtConflict: COMMIT_B,
      canonicalAfterCleanup: { head: COMMIT_B, worktree: "clean" },
    },
  });
}

function resolverIdOf(graph: GraphV2): string {
  const resolver = graph.nodes.find((node) => node.id.startsWith("gen-"));
  if (!resolver) {
    throw new Error("R が挿入されていない");
  }
  return resolver.id;
}

/** 挿入された R を Worker が claim した状態。 */
function claimReadyForResolver(graph: GraphV2, resolverId: string) {
  const claimed = claimReady(graph, {
    type: "claim_ready",
    limit: 5,
    startedAt: T0,
    workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
  });
  const fence = claimed.assignments.find((a) => a.nodeId === resolverId);
  if (!fence) {
    throw new Error("R が claim できていない");
  }
  return { graph: claimed.graph, fence };
}

/** 提出済みの R を Integrator が統合し、success で解消 chain を閉じた後のグラフを返す。 */
function resolveRThroughIntegration(
  workerClaimed: ReturnType<typeof claimReadyForResolver>,
  resolverId: string,
): GraphV2 {
  const submitted = submitCandidate(workerClaimed.graph, {
    type: "submit_candidate",
    nodeId: resolverId,
    fence: workerClaimed.fence,
    commit: CHECKED,
    report: { summary: SUMMARY, data: null },
    submittedAt: T0,
  });
  const integration = claimIntegration(submitted, {
    type: "claim_integration",
    workspaceId: WORKSPACE_INTEGRATION,
    startedAt: T0,
    canonicalHeadBefore: COMMIT_B,
  });
  const integratorFence = fenceOf(integration.journal.assignment);
  const merged = advanceIntegration(integration.graph, {
    type: "advance_integration",
    fence: integratorFence,
    progress: { stage: "merge_prepared", integratedCommit: CHECKED },
  });
  const prepared = advanceIntegration(merged, {
    type: "advance_integration",
    fence: integratorFence,
    progress: {
      stage: "publish_prepared",
      integratedCommit: CHECKED,
      verification: { checkedCommit: CHECKED, outputDigest: DIGEST, finishedAt: T1 },
    },
  });
  return recordIntegrationOutcome(prepared, {
    type: "record_integration_outcome",
    fence: integratorFence,
    outcome: { kind: "success" },
  });
}

describe("recordIntegrationOutcome: conflict insertion", () => {
  it("C を blocked(integration_conflict) にして解消ノード R を機械挿入する", () => {
    expect.hasAssertions();
    const setup = integratingWithConflictedTask();
    const next = recordIntegrationOutcome(setup.graph, {
      type: "record_integration_outcome",
      fence: setup.fence,
      outcome: {
        kind: "conflict",
        reason: REASON,
        title: nonEmptyStringSchema.parse("c1 の衝突を解消する"),
        files: FILES,
        canonicalHeadAtConflict: COMMIT_B,
        canonicalAfterCleanup: { head: COMMIT_B, worktree: "clean" },
      },
    });

    expectConflictedC(next);
    expectInsertedResolver(next);

    // allocator が3つ（blockage / conflict / R）進んでいる
    expect(next.nextAllocationId).toBe(setup.graph.nextAllocationId + ALLOCATION_IDS_PER_CONFLICT);
  });

  it("R の統合成功で、R と C が同時に done になる（解消 chain の閉包）", () => {
    expect.hasAssertions();
    // 1. conflict で C を blocked + R を挿入
    const cBlocked = insertConflict(integratingWithConflictedTask());
    const resolverId = resolverIdOf(cBlocked);

    // 2. R を通常の repository_change ノードとして claim -> submit -> integrate
    const workerClaimed = claimReadyForResolver(cBlocked, resolverId);
    const closed = resolveRThroughIntegration(workerClaimed, resolverId);

    expectRDoneAsResolved(closed, resolverId);
    expectCDoneAsResolved(closed);
  });
});
