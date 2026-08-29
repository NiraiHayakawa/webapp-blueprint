// ramune_apply_ops の insert_parallel_node（§8）。insert_node と異なり既存エッジの
// 実在を前提条件にしないため、素の start -> end 骨格から独立な並列ノードを複数
// fan-out できる（1本目の insert_node の splice でエッジが消え2本目が
// edge_not_found になる問題の解決策。設計正本
// docs/plan/Ramune/20260824_parallel-execution.md §8）。
import { afterEach, describe, expect, it } from "vitest";
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import { callToolJson, type TestClientHandle } from "./connect-test-client.ts";
import { connectAndStart, findNode, readGraph } from "./support.ts";

async function applyInsertParallelNode(
  handle: TestClientHandle,
  expectedRevision: number,
  op: {
    readonly type: "insert_parallel_node";
    readonly from: string;
    readonly to: string;
    readonly newNode: {
      readonly id: string;
      readonly title: string;
      readonly effect: "read_only" | "repository_change";
    };
  },
): Promise<GraphV2> {
  return await callToolJson<GraphV2>(handle, "ramune_apply_ops", {
    expected_revision: expectedRevision,
    operations: [op],
  });
}

describe("ramune_apply_ops — insert_parallel_node", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("既存エッジの実在を要求せず、素の start -> end 骨格から独立ノードを2本 fan-out できる", async () => {
    handle = await connectAndStart();
    const before = await readGraph(handle);

    const next = await applyInsertParallelNode(handle, before.revision, {
      type: "insert_parallel_node",
      from: "start",
      to: "end",
      newNode: { id: "p1", title: "並列タスク1", effect: "read_only" },
    });
    const withBoth = await applyInsertParallelNode(handle, next.revision, {
      type: "insert_parallel_node",
      from: "start",
      to: "end",
      newNode: { id: "p2", title: "並列タスク2", effect: "read_only" },
    });

    expect(findNode(withBoth, "end")?.deps).toStrictEqual(["start", "p1", "p2"]);
    expect(findNode(withBoth, "p1")).toMatchObject({
      kind: "task",
      deps: ["start"],
      purpose: "planned",
      effect: "read_only",
      status: "pending",
    });
    expect(findNode(withBoth, "p2")).toMatchObject({
      kind: "task",
      deps: ["start"],
      purpose: "planned",
      effect: "read_only",
      status: "pending",
    });
  });
});
