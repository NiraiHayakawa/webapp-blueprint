// Worker 系ツールの公開契約（§3 / §4 / §6.1 / §8）:
// ramune_claim_ready（宣言順・limit・原子性・base_commit 記録）、ramune_record_result、
// ramune_submit_candidate（source のサーバコピー）、ramune_request_replan。
import { afterEach, describe, expect, it } from "vitest";
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import {
  callToolJson,
  expectDomainRejection,
  type TestClientHandle,
} from "./connect-test-client.ts";
import {
  type AssignmentWire,
  connectAndStart,
  insertTask,
  readGraph,
  toWireFence,
} from "./support.ts";

const BASE_COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SUMMARY = "作業報告";
const CLAIM_LIMIT_ABOVE_READY = 5;
const STALE_ASSIGNMENT_ID_OFFSET = 100;
const STALE_EXPECTED_REVISION = 999;

function findNode(graph: GraphV2, id: string) {
  return graph.nodes.find((node) => node.id === id);
}

async function claim(
  handle: TestClientHandle,
  limit = 1,
): Promise<{ readonly graph: GraphV2; readonly assignments: readonly AssignmentWire[] }> {
  const current = await readGraph(handle);
  return await callToolJson(handle, "ramune_claim_ready", {
    expected_revision: current.revision,
    limit,
    base_commit: BASE_COMMIT,
  });
}

/** 単一ノードを claim し、その 1 件の fence を返す（claim できなければテスト失敗）。 */
async function claimFirst(handle: TestClientHandle): Promise<AssignmentWire> {
  const claimed = await claim(handle);
  const [fence] = claimed.assignments;
  if (!fence) {
    throw new Error("claim に失敗");
  }
  return fence;
}

describe("ramune_claim_ready — 基本", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("ready ノードを宣言順で選び、fence（runId / epoch / 発番 id）を返す", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "ro1", { effect: "read_only" });

    const result = await claim(handle);

    expect(result.assignments).toHaveLength(1);
    const [assignment] = result.assignments;
    if (!assignment) {
      throw new Error("claim に失敗");
    }
    expect(assignment).toMatchObject({
      role: "worker",
      effect: "read_only",
      nodeId: "ro1",
      epoch: 0,
      id: 1,
    });
    expect(findNode(result.graph, "ro1")?.status).toBe("running");
  });

  it("連続 claim が同じノードを返さない（claim の原子性）", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "r1");

    const first = await claim(handle);
    const second = await claim(handle);

    // 最初の claim で r1 は running へ遷移済みのため、2 度目は空であり
    // 同じノードが二度渡されることはない
    expect(first.assignments.map((a) => a.nodeId)).toStrictEqual(["r1"]);
    expect(second.assignments).toStrictEqual([]);
  });
});

describe("ramune_claim_ready — repository_change の記録", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("repository_change ノードには workspaceId と base_commit が記録される", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "r1");

    const result = await claim(handle);

    const [assignment] = result.assignments;
    if (!assignment) {
      throw new Error("claim に失敗");
    }
    expect(assignment.effect).toBe("repository_change");
    expect(assignment.workspaceId).toMatch(/^ws-/u);
    expect(assignment.baseCommit).toBe(BASE_COMMIT);
  });
});

describe("ramune_claim_ready — limit と revision", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("limit を超えない。現行の操作セットはエッジ分割のみのため ready は鎖上で高々 1 件", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "ro1", { effect: "read_only" });
    // ro1 の手前に挿入して鎖を伸ばす（start → r1 → ro1 → end）
    await insertTask(handle, "r1", { effect: "read_only", from: "start", to: "ro1" });

    const result = await claim(handle, CLAIM_LIMIT_ABOVE_READY);

    // 先頭の r1 だけが ready。limit が大きくても ready 数を超えて claim しない
    expect(result.assignments.map((a) => a.nodeId)).toStrictEqual(["r1"]);
    // ro1 は依然 pending のまま
    expect(findNode(result.graph, "ro1")?.status).toBe("pending");
  });

  it("expected_revision の不一致では claim されない（判断系の OCC）", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "r1");

    const message = await expectDomainRejection(handle, "ramune_claim_ready", {
      expected_revision: STALE_EXPECTED_REVISION,
      limit: 1,
      base_commit: BASE_COMMIT,
    });

    expect(message).toContain("revision の不一致");
    // claim は行われずノードも pending のまま
    const afterRejection = await readGraph(handle);
    expect(findNode(afterRejection, "r1")?.status).toBe("pending");
  });
});

describe("ramune_record_result", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("read_only ノードを done にし、completedBy 付きの完了証跡を書く", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "ro1", { effect: "read_only" });
    const fence = await claimFirst(handle);

    const next = await callToolJson<GraphV2>(handle, "ramune_record_result", {
      fence: toWireFence(fence),
      report: { summary: SUMMARY, data: { found: 42 } },
    });

    const ro1 = findNode(next, "ro1");
    expect(ro1?.status).toBe("done");
    if (ro1?.kind !== "task" || ro1.status !== "done") {
      throw new Error("ro1 は done な task のはず");
    }
    expect(ro1.result).toMatchObject({
      kind: "read_only",
      completedBy: { nodeId: "ro1", id: fence.id },
    });
  });

  it("assignmentId 不一致の stale fence は拒否される", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "ro1", { effect: "read_only" });
    const fence = await claimFirst(handle);
    const wire = toWireFence(fence);

    const message = await expectDomainRejection(handle, "ramune_record_result", {
      fence: { ...wire, id: fence.id + STALE_ASSIGNMENT_ID_OFFSET },
      report: { summary: SUMMARY, data: null },
    });

    expect(message).toContain("stale_fence");
  });
});

describe("ramune_submit_candidate", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("candidate を受理し、source は assignment のコピーである（Worker の申告ではない）", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "r1");
    const fence = await claimFirst(handle);

    const next = await callToolJson<GraphV2>(handle, "ramune_submit_candidate", {
      fence: toWireFence(fence),
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      report: { summary: SUMMARY, data: null },
    });

    const r1 = findNode(next, "r1");
    expect(r1?.status).toBe("awaiting_integration");
    if (
      r1?.kind !== "task" ||
      r1.effect !== "repository_change" ||
      r1.status !== "awaiting_integration"
    ) {
      throw new Error("r1 は awaiting_integration な repository_change task のはず");
    }
    expect(r1.candidate.commit).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(r1.candidate.source).toMatchObject({
      role: "worker",
      nodeId: "r1",
      workspaceId: fence.workspaceId,
      baseCommit: BASE_COMMIT,
    });
  });
});

describe("ramune_request_replan", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("running ノードを blocked(worker_request) にする", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "ro1", { effect: "read_only" });
    const fence = await claimFirst(handle);

    const next = await callToolJson<GraphV2>(handle, "ramune_request_replan", {
      fence: toWireFence(fence),
      reason: "仕様が決まっていない",
    });

    const ro1 = findNode(next, "ro1");
    expect(ro1?.status).toBe("blocked");
    if (
      ro1?.kind !== "task" ||
      ro1.effect !== "read_only" ||
      ro1.status !== "blocked" ||
      ro1.phase !== "execution"
    ) {
      throw new Error("ro1 は blocked な execution phase の read_only task のはず");
    }
    expect(ro1.blockage.kind).toBe("worker_request");
  });

  it("pending ノード（誰も claim していない）への信号は拒否される", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "r1");

    const message = await expectDomainRejection(handle, "ramune_request_replan", {
      fence: { id: 1, node_id: "r1", run_id: "run-x", epoch: 0 },
      reason: "詰まった",
    });

    expect(message).toContain("not_claimed_by_fence");
  });
});
