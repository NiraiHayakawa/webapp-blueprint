// insert_parallel_node の公開契約。既存エッジの実在を前提条件にしない fan-out 専用の
// 構造操作であり、素の start -> end 骨格から独立な並列ノードを複数作れることが
// insert_node（既存エッジの splice 専用）との差分（設計正本
// docs/plan/Ramune/20260824_parallel-execution.md §8）。
import { describe, expect, it } from "vitest";
import {
  claimReady,
  createGraph,
  findNode,
  GraphInvariantViolationError,
  insertParallelNode,
  InsertParallelNodePreconditionError,
  isoDateTimeSchema,
  plannedNodeIdSchema,
  runIdSchema,
  startSession,
  type GraphV2,
} from "../src/index.ts";
import {
  graphWithTask,
  pendingReadOnly,
  readOnlyAssignmentOf,
  thrownBy,
  titleOf,
} from "./test-support.ts";

const NEW_ID = plannedNodeIdSchema.parse("n-new");
const NEW_ID_2 = plannedNodeIdSchema.parse("n-new-2");
const T0 = isoDateTimeSchema.parse("2026-08-24T00:00:00Z");

describe("insertParallelNode: 骨格から fan-out して claim_ready できる", () => {
  it(
    "createGraph 直後の骨格から insert_parallel_node を2回適用して独立ノードを2つ作り、" +
      "claim_ready(limit=2) が2 fence を返す",
    () => {
      expect.hasAssertions();
      const skeleton = startSession(createGraph("goal"), {
        type: "start_session",
        runId: runIdSchema.parse("run-x"),
      });
      const withFirst = insertParallelNode(skeleton, {
        type: "insert_parallel_node",
        from: "start",
        to: "end",
        newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "read_only" },
      });
      const withBoth = insertParallelNode(withFirst, {
        type: "insert_parallel_node",
        from: "start",
        to: "end",
        newNode: { id: NEW_ID_2, title: titleOf("n-new-2"), effect: "read_only" },
      });
      expect(findNode(withBoth, "end")?.deps).toStrictEqual(["start", "n-new", "n-new-2"]);

      const claimed = claimReady(withBoth, { type: "claim_ready", limit: 2, startedAt: T0 });
      expect(claimed.assignments).toHaveLength(2);
      expect(claimed.assignments.map((a) => a.nodeId)).toStrictEqual(["n-new", "n-new-2"]);
    },
  );
});

describe(insertParallelNode, () => {
  it("newNode.deps は [from] のみで、to の既存 deps は変更せず追記する", () => {
    expect.hasAssertions();
    const next = insertParallelNode(graphWithTask(), {
      type: "insert_parallel_node",
      from: "start",
      to: "n1",
      newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "repository_change" },
    });
    expect(findNode(next, "n1")?.deps).toStrictEqual(["start", "n-new"]);
    const inserted = findNode(next, "n-new");
    expect(inserted).toMatchObject({
      kind: "task",
      deps: ["start"],
      purpose: "planned",
      effect: "repository_change",
      status: "pending",
    });
  });

  it("既存エッジの実在を要求しない（insert_node との差分）", () => {
    expect.hasAssertions();
    // n1 -> n2 のエッジは存在しない（n2 は独立に start に依存するのみ）が、
    // insert_parallel_node は edge_not_found 相当の拒否をしない
    const base = createGraph("goal");
    const graph = {
      ...base,
      nodes: [...base.nodes, pendingReadOnly("n1", ["start"]), pendingReadOnly("n2", ["start"])],
    };
    const next = insertParallelNode(graph, {
      type: "insert_parallel_node",
      from: "n1",
      to: "n2",
      newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "read_only" },
    });
    expect(findNode(next, "n2")?.deps).toStrictEqual(["start", "n-new"]);
  });

  it("1 操作で revision が +1 される", () => {
    expect.hasAssertions();
    const before = graphWithTask();
    const next = insertParallelNode(before, {
      type: "insert_parallel_node",
      from: "start",
      to: "n1",
      newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "read_only" },
    });
    expect(next.revision).toBe(before.revision + 1);
  });
});

describe("insertParallelNode の前提条件エラー: it.each", () => {
  it.each([
    [{ reason: "from_not_found" }, { type: "insert_parallel_node", from: "ghost", to: "n1" }],
    [{ reason: "to_not_found" }, { type: "insert_parallel_node", from: "start", to: "ghost" }],
    [{ reason: "from_equals_to" }, { type: "insert_parallel_node", from: "n1", to: "n1" }],
    [{ reason: "from_not_allowed" }, { type: "insert_parallel_node", from: "end", to: "n1" }],
    [{ reason: "to_not_allowed" }, { type: "insert_parallel_node", from: "n2", to: "start" }],
  ] as const)("前提条件違反 %s は InsertParallelNodePreconditionError", (expected, partial) => {
    expect.hasAssertions();
    // SAFETY: it.each の各ケースは意図的に不完全な insert_parallel_node 操作であり、
    // InsertParallelNodePreconditionError を発生させるためのテスト専用データ。
    const op = {
      ...partial,
      newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "read_only" },
    } as Parameters<typeof insertParallelNode>[1];
    const error = thrownBy(() => {
      insertParallelNode(graphWithTask(), op);
    });
    if (!(error instanceof InsertParallelNodePreconditionError)) {
      throw new Error("InsertParallelNodePreconditionError になるべき");
    }
    expect(error.violation.reason).toBe(expected.reason);
  });
});

describe("insertParallelNode の前提条件エラー: 個別ケース", () => {
  it("実行中のノードを to にはできない（to_not_allowed）", () => {
    expect.hasAssertions();
    const running = {
      ...pendingReadOnly("r1", ["start"]),
      status: "running",
      assignment: readOnlyAssignmentOf("r1"),
    } satisfies GraphV2["nodes"][number];
    const base = createGraph("goal");
    const graph = { ...base, nodes: [...base.nodes, running] };
    const error = thrownBy(() => {
      insertParallelNode(graph, {
        type: "insert_parallel_node",
        from: "start",
        to: "r1",
        newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "read_only" },
      });
    });
    if (!(error instanceof InsertParallelNodePreconditionError)) {
      throw new Error("InsertParallelNodePreconditionError になるべき");
    }
    expect(error.violation.reason).toBe("to_not_allowed");
  });

  it("既存 id への挿入は duplicate_new_id", () => {
    expect.hasAssertions();
    const existing = plannedNodeIdSchema.parse("n2");
    expect(() =>
      insertParallelNode(graphWithTask(), {
        type: "insert_parallel_node",
        from: "start",
        to: "n1",
        newNode: { id: existing, title: titleOf("n2"), effect: "read_only" },
      }),
    ).toThrow(InsertParallelNodePreconditionError);
  });
});

describe("insertParallelNode はサイクルになる挿入を不変条件検査で拒否する", () => {
  it("GraphInvariantViolationError で拒否される", () => {
    expect.hasAssertions();
    // n2 は既に n1 に依存する（n2.deps=["n1"]）。from: n2, to: n1 にすると
    // n1 -> newNode -> n2 -> n1 のサイクルになる
    expect(() =>
      insertParallelNode(graphWithTask(), {
        type: "insert_parallel_node",
        from: "n2",
        to: "n1",
        newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "read_only" },
      }),
    ).toThrow(GraphInvariantViolationError);
  });
});
