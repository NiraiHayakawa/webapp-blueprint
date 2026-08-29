// ramune_record_integration_outcome の conflict 経路の公開契約（§6.3）:
// conflict outcome による blocked(integration_conflict) 化と解消ノード R の機械挿入、
// R の統合成功で解消 chain 全体を同時に done にする閉包。
import { afterEach, describe, expect, it } from "vitest";
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import { callToolJson, type TestClientHandle } from "./connect-test-client.ts";
import {
  CANONICAL_BEFORE,
  CANDIDATE,
  connectAndStart,
  findNode,
  INTEGRATED,
  integrateUntilPublishPrepared,
  prepareCandidate,
  readGraph,
  toWireFence,
} from "./support.ts";
import type { AssignmentWire } from "./support.ts";

/** C が blocked(integration_conflict) へ遷移し、R の ID が C.deps へ追加されたことを見る。 */
function expectConflictedC(conflicted: GraphV2): void {
  const c1 = findNode(conflicted, "c1");
  expect(c1?.status).toBe("blocked");
  if (c1?.kind !== "task" || c1.effect !== "repository_change") {
    return;
  }
  if (c1.status !== "blocked" || c1.phase !== "integration") {
    return;
  }
  if (c1.blockage.kind !== "integration_conflict") {
    // blockage が違う場合はテスト失敗（unreachable）
    throw new Error(`blockage は integration_conflict であるべき（実際: ${c1.blockage.kind}）`);
  }
  expect(c1.blockage.canonicalAfterCleanup.worktree).toBe("clean");
  // R の ID が C.deps へ追加される
  expect(c1.deps).toContain(c1.blockage.resolutionNodeId);
}

/** 挿入された R が planned 目的の pending repository task で、resolves 相互参照を持つことを見る。 */
function expectInsertedResolver(conflicted: GraphV2): void {
  const resolver = conflicted.nodes.find((node) => node.id.startsWith("gen-"));
  if (resolver?.kind !== "task") {
    throw new Error("R は task");
  }
  expect(resolver.purpose).toBe("conflict_resolution");
  if (resolver.purpose !== "conflict_resolution") {
    return;
  }
  expect(resolver.resolves).toBe("c1");
  expect(resolver.status).toBe("pending");
}

/** R が done になり、完了証跡が自身を resolutionNodeId とする conflict_resolved であることを見る。 */
function expectRDoneAsResolved(closed: GraphV2, resolverId: string): void {
  const r = findNode(closed, resolverId);
  expect(r?.status).toBe("done");
  if (r?.kind !== "task" || r.status !== "done" || r.effect !== "repository_change") {
    return;
  }
  if (r.result.kind !== "conflict_resolved") {
    // 完了証跡が違う場合はテスト失敗（unreachable）
    throw new Error(`R の結果は conflict_resolved であるべき（実際: ${r.result.kind}）`);
  }
  expect(r.result.resolutionNodeId).toBe(resolverId);
}

/** C も done になり、candidate が保持されていることを見る。 */
function expectCDoneAsResolved(closed: GraphV2): void {
  const c1 = findNode(closed, "c1");
  expect(c1?.status).toBe("done");
  if (c1?.kind !== "task" || c1.status !== "done" || c1.effect !== "repository_change") {
    return;
  }
  expect(c1.result.kind).toBe("conflict_resolved");
  expect(c1.candidate.commit).toBe(CANDIDATE);
}

/** c1 を conflict で衝突させ、R 挿入済みグラフを返す。 */
async function recordConflictOnC1(
  handle: TestClientHandle,
  files: readonly string[] = [],
): Promise<GraphV2> {
  await prepareCandidate(handle, "c1");
  const integratorFence = await integrateUntilPublishPrepared(handle);

  return await callToolJson<GraphV2>(handle, "ramune_record_integration_outcome", {
    fence: integratorFence,
    outcome: {
      kind: "conflict",
      reason: "README の衝突",
      title: "c1 の衝突を解消する",
      files,
      canonical_head_at_conflict: CANONICAL_BEFORE,
      canonical_after_cleanup: { head: CANONICAL_BEFORE },
    },
  });
}

/** 解消ノード R（gen-*）を通常の repository_change として claim し、candidate を提出する。 */
async function submitResolvedByR(handle: TestClientHandle, conflicted: GraphV2): Promise<void> {
  const resolverId = conflicted.nodes.find((node) => node.id.startsWith("gen-"))?.id;
  if (resolverId === undefined) {
    throw new Error("R が挿入されていない");
  }

  const afterWorkerClaim = await callToolJson<{
    readonly assignments: readonly AssignmentWire[];
  }>(handle, "ramune_claim_ready", {
    expected_revision: conflicted.revision,
    limit: 5,
    base_commit: CANONICAL_BEFORE,
  });
  const workerFence = afterWorkerClaim.assignments.find((a) => a.nodeId === resolverId);
  if (!workerFence) {
    throw new Error("R が claim できていない");
  }

  await callToolJson(handle, "ramune_submit_candidate", {
    fence: toWireFence(workerFence),
    commit: INTEGRATED,
    report: { summary: "衝突を解消した", data: null },
  });
}

/** 提出済みの R を Integrator が統合し、success で chain を閉じた後のグラフを返す。 */
async function resolveViaR(handle: TestClientHandle): Promise<GraphV2> {
  const beforeIntegration = await readGraph(handle);
  const integration = await callToolJson<{
    readonly journal: { readonly assignment: Parameters<typeof toWireFence>[0] };
  }>(handle, "ramune_claim_integration", {
    expected_revision: beforeIntegration.revision,
    canonical_head_before: CANONICAL_BEFORE,
  });
  const rWireFence = toWireFence(integration.journal.assignment);
  await callToolJson(handle, "ramune_advance_integration", {
    fence: rWireFence,
    progress: { stage: "merge_prepared", integrated_commit: INTEGRATED },
  });
  await callToolJson(handle, "ramune_advance_integration", {
    fence: rWireFence,
    progress: {
      stage: "publish_prepared",
      integrated_commit: INTEGRATED,
      verification: {
        checked_commit: INTEGRATED,
        output_digest: "digest-r",
        finished_at: "2026-08-24T02:00:00Z",
      },
    },
  });

  return await callToolJson<GraphV2>(handle, "ramune_record_integration_outcome", {
    fence: rWireFence,
    outcome: { kind: "success" },
  });
}

/** conflict 記録から R の完遂・chain 閉包までを通しで行い、閉包後のグラフを返す。 */
async function setupConflictThenResolveViaR(handle: TestClientHandle): Promise<GraphV2> {
  const conflicted = await recordConflictOnC1(handle, ["docs/plan/Template/README.md"]);
  await submitResolvedByR(handle, conflicted);
  return await resolveViaR(handle);
}

describe("ramune_record_integration_outcome: conflict による機械挿入", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("conflict outcome により C が blocked(integration_conflict) になり R が機械挿入される", async () => {
    expect.hasAssertions();
    handle = await connectAndStart();
    const conflicted = await recordConflictOnC1(handle);

    expectConflictedC(conflicted);
    expectInsertedResolver(conflicted);
  });
});

describe("ramune_record_integration_outcome: conflict の chain 閉包", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("R の統合成功で、R と C が同時に done になる（解消 chain の閉包）", async () => {
    expect.hasAssertions();
    handle = await connectAndStart();

    const closed = await setupConflictThenResolveViaR(handle);

    const resolverId = closed.nodes.find((node) => node.id.startsWith("gen-"))?.id;
    if (resolverId === undefined) {
      throw new Error("R が無い");
    }
    expectRDoneAsResolved(closed, resolverId);
    expectCDoneAsResolved(closed);
  });
});
