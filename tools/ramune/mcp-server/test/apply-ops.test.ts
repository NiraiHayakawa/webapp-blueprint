// ramune_apply_ops の公開契約（§8）:
// 構造操作列（insert_node / reopen / abort）+ expected_revision、実行中ノードの
// 存在時の拒否、set_result の廃止（スキーマが受理しない）、reopen resolution 必須。
import { afterEach, describe, expect, it } from "vitest";
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import {
  callToolJson,
  expectDomainRejection,
  expectSchemaViolation,
  type TestClientHandle,
} from "./connect-test-client.ts";
import { connectAndStart, insertTask, readGraph, type AssignmentFenceWire } from "./support.ts";

/**
 * ramune_apply_ops のワイヤ入力（tools/apply-ops.ts の insertNodeOperationSchema /
 * reopenOperationSchema / abortOperationSchema をそのまま写した形）。ドメイン層の
 * GraphOperation は id / resolution 等がブランド型であり、境界を越える前の
 * ワイヤ表現はここでは常にプレーンな string として扱う（support.ts の
 * AssignmentWire と同じ、ワイヤ/ドメインを分ける方針）。
 */
type ApplyOpsOperation =
  | {
      readonly type: "insert_node";
      readonly from: string;
      readonly to: string;
      readonly newNode: {
        readonly id: string;
        readonly title: string;
        readonly effect: "read_only" | "repository_change";
      };
    }
  | {
      readonly type: "reopen";
      readonly nodeId: string;
      readonly resolution: string;
    }
  | {
      readonly type: "abort";
      readonly nodeId: string;
    };

const BASE_COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REVISION_DRIFT = 5;

function findNode(graph: GraphV2, id: string) {
  return graph.nodes.find((node) => node.id === id);
}

async function applyOps(
  handle: TestClientHandle,
  expectedRevision: number,
  operations: readonly ApplyOpsOperation[],
): Promise<GraphV2> {
  return await callToolJson<GraphV2>(handle, "ramune_apply_ops", {
    expected_revision: expectedRevision,
    operations,
  });
}

async function rejectOps(
  handle: TestClientHandle,
  expectedRevision: number,
  operations: readonly ApplyOpsOperation[],
): Promise<string> {
  return await expectDomainRejection(handle, "ramune_apply_ops", {
    expected_revision: expectedRevision,
    operations,
  });
}

/** ro1 を claim し、request_replan で blocked(worker_request) にした後のグラフを返す。 */
async function claimAndRequestReplan(handle: TestClientHandle): Promise<GraphV2> {
  const beforeClaim = await readGraph(handle);
  const claimed = await callToolJson<{ readonly assignments: readonly AssignmentFenceWire[] }>(
    handle,
    "ramune_claim_ready",
    {
      expected_revision: beforeClaim.revision,
      limit: 1,
      base_commit: BASE_COMMIT,
    },
  );
  const [fence] = claimed.assignments;
  if (!fence) {
    throw new Error("claim に失敗");
  }
  await callToolJson(handle, "ramune_request_replan", {
    fence: { id: fence.id, node_id: fence.nodeId, run_id: fence.runId, epoch: fence.epoch },
    reason: "仕様が決まっていない",
  });
  return await readGraph(handle);
}

/** reopen 済みノードが task であり、resolution が resolutions へ 1 件記録されたことを確かめる。 */
function expectResolutionRecorded(graph: GraphV2, nodeId: string, resolution: string): void {
  const node = findNode(graph, nodeId);
  expect(node?.status).toBe("pending");
  if (node?.kind !== "task") {
    throw new Error(`${nodeId} が task ノードではない`);
  }
  expect(node.resolutions).toHaveLength(1);
  expect(node.resolutions[0]).toMatchObject({ resolution });
}

const INSERT_N1 = {
  type: "insert_node",
  from: "start",
  to: "end",
  newNode: { id: "n1", title: "task 1", effect: "read_only" },
} as const;

describe("ramune_apply_ops — insert_node と revision", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("insert_node を適用し、成功した transaction で revision がちょうど +1 される", async () => {
    handle = await connectAndStart();
    const before = await readGraph(handle);

    const next = await applyOps(handle, before.revision, [INSERT_N1]);

    expect(next.revision).toBe(before.revision + 1);
    const inserted = findNode(next, "n1");
    expect(inserted).toMatchObject({
      kind: "task",
      purpose: "planned",
      effect: "read_only",
      status: "pending",
      deps: ["start"],
    });
  });

  it("expected_revision の不一致は RevisionConflictError として isError で返る（自動リトライしない）", async () => {
    handle = await connectAndStart();
    const current = await readGraph(handle);

    const message = await rejectOps(handle, current.revision + REVISION_DRIFT, [INSERT_N1]);

    expect(message).toContain("revision の不一致");
    expect(message).toContain(`expected: ${String(current.revision + REVISION_DRIFT)}`);
    expect(message).toContain(`actual: ${String(current.revision)}`);
    // 自動リトライされないためグラフは変化しない
    const unchanged = await readGraph(handle);
    expect(unchanged.revision).toBe(current.revision);
  });
});

describe("ramune_apply_ops — 実行中ノードの拒否", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("running ノードが存在すると GraphHasActiveNodesError で拒否される", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "r1");
    // r1 を claim して running へ
    const current = await readGraph(handle);
    await callToolJson(handle, "ramune_claim_ready", {
      expected_revision: current.revision,
      limit: 1,
      base_commit: BASE_COMMIT,
    });

    const afterClaim = await readGraph(handle);
    const message = await rejectOps(handle, afterClaim.revision, [
      {
        type: "insert_node",
        from: "start",
        to: "end",
        newNode: { id: "n9", title: "task 9", effect: "read_only" },
      },
    ]);

    expect(message).toContain("実行中のノード");
    expect(message).toContain("r1");
  });
});

describe("ramune_apply_ops — 廃止された操作とスキーマ", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("set_result 操作は廃止されたため JSON Schema 段階で拒否される（旧契約の受理を残さない）", async () => {
    handle = await connectAndStart();
    const current = await readGraph(handle);

    await expectSchemaViolation(handle, "ramune_apply_ops", {
      expected_revision: current.revision,
      operations: [{ type: "set_result", nodeId: "n1", result: null }],
    });
    // JSON Schema 違反はグラフに一切適用されない
    const unchanged = await readGraph(handle);
    expect(unchanged.revision).toBe(current.revision);
  });

  it("reopen には resolution が必須であり、欠けていると JSON Schema 違反になる", async () => {
    handle = await connectAndStart();
    const current = await readGraph(handle);

    await expectSchemaViolation(handle, "ramune_apply_ops", {
      expected_revision: current.revision,
      operations: [{ type: "reopen", nodeId: "n1" }],
    });
    const unchanged = await readGraph(handle);
    expect(unchanged.revision).toBe(current.revision);
  });
});

describe("ramune_apply_ops — reopen", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("blocked ノードは resolution を付けて reopen でき、resolutions へ記録される", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "ro1", { effect: "read_only" });
    const blocked = await claimAndRequestReplan(handle);
    expect(findNode(blocked, "ro1")?.status).toBe("blocked");

    const next = await applyOps(handle, blocked.revision, [
      { type: "reopen", nodeId: "ro1", resolution: "ユーザー決定: A案で進める" },
    ]);

    expectResolutionRecorded(next, "ro1", "ユーザー決定: A案で進める");
  });

  it("pending に戻したノードを再度 reopen しようとすると not_blocked で拒否される", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "ro1", { effect: "read_only" });
    const blocked = await claimAndRequestReplan(handle);

    const reopened = await applyOps(handle, blocked.revision, [
      { type: "reopen", nodeId: "ro1", resolution: "解決策" },
    ]);
    expect(findNode(reopened, "ro1")?.status).toBe("pending");

    const current = await readGraph(handle);
    const message = await rejectOps(handle, current.revision, [
      { type: "reopen", nodeId: "ro1", resolution: "二度目の reopen" },
    ]);
    expect(message).toContain("not_blocked");
  });
});
