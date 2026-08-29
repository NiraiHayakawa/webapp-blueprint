// insert_node / reopen / abort / applyOperations の公開契約。
// insert_parallel_node は insert-parallel-node.test.ts に分離する（原則7:
// 拡張はファイルの追加で表現される。既存ファイルへの際限ない追記をしない）。
import { describe, expect, it } from "vitest";
import {
  abort,
  AbortPreconditionError,
  allocationIdSchema,
  applyOperations,
  assignmentIdSchema,
  blockageIdSchema,
  createGraph,
  epochSchema,
  findNode,
  insertNode,
  InsertNodePreconditionError,
  nonEmptyStringSchema,
  plannedNodeIdSchema,
  reopen,
  ReopenPreconditionError,
  revisionSchema,
  runIdSchema,
  type AssignmentFence,
  type ExecutionBlockage,
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
const SUMMARY = nonEmptyStringSchema.parse("s");
const FENCE: AssignmentFence = {
  id: assignmentIdSchema.parse(1),
  nodeId: plannedNodeIdSchema.parse("n1"),
  runId: runIdSchema.parse("run-x"),
  epoch: epochSchema.parse(0),
};
const WORKER_REQUEST_BLOCKAGE: ExecutionBlockage = {
  id: blockageIdSchema.parse(1),
  reason: SUMMARY,
  occurredAtRevision: revisionSchema.parse(1),
  kind: "worker_request",
  assignment: FENCE,
};

const PRE_ALLOCATED_ID = 10;

function graphWithBlocked(): GraphV2 {
  const graph = createGraph("goal");
  // blockage / fence の ID が発番済みとして台帳に載るため、allocator を先に進めておく
  return {
    ...graph,
    nextAllocationId: allocationIdSchema.parse(PRE_ALLOCATED_ID),
    nodes: [
      ...graph.nodes,
      {
        ...pendingReadOnly("n1", ["start"]),
        status: "blocked",
        phase: "execution",
        blockage: WORKER_REQUEST_BLOCKAGE,
      },
    ],
  };
}

describe(insertNode, () => {
  it("エッジを from -> newNode -> to に組み替え、purpose: planned の task を挿入する", () => {
    expect.hasAssertions();
    const next = insertNode(graphWithTask(), {
      type: "insert_node",
      from: "start",
      to: "n1",
      newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "repository_change" },
    });
    expect(findNode(next, "n1")?.deps).toStrictEqual(["n-new"]);
    const inserted = findNode(next, "n-new");
    expect(inserted).toMatchObject({
      kind: "task",
      deps: ["start"],
      purpose: "planned",
      effect: "repository_change",
      status: "pending",
    });
  });

  it("1 操作で revision が +1 される", () => {
    expect.hasAssertions();
    const before = graphWithTask();
    const next = insertNode(before, {
      type: "insert_node",
      from: "start",
      to: "n1",
      newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "read_only" },
    });
    expect(next.revision).toBe(before.revision + 1);
  });
});

describe("insertNode の前提条件エラー", () => {
  it.each([
    [{ reason: "to_not_found" }, { type: "insert_node", from: "start", to: "ghost" }],
    [{ reason: "edge_not_found" }, { type: "insert_node", from: "n2", to: "n1" }],
    [{ reason: "from_not_allowed" }, { type: "insert_node", from: "end", to: "n1" }],
    [{ reason: "to_not_allowed" }, { type: "insert_node", from: "n2", to: "start" }],
  ] as const)("前提条件違反 %s は InsertNodePreconditionError", (expected, partial) => {
    expect.hasAssertions();
    // SAFETY: it.each の各ケースは意図的に不完全な insert_node 操作であり、
    // InsertNodePreconditionError を発生させるためのテスト専用データ。
    const op = {
      ...partial,
      newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "read_only" },
    } as Parameters<typeof insertNode>[1];
    const error = thrownBy(() => {
      insertNode(graphWithTask(), op);
    });
    if (!(error instanceof InsertNodePreconditionError)) {
      throw new Error("InsertNodePreconditionError になるべき");
    }
    expect(error.violation.reason).toBe(expected.reason);
  });

  it("既存 id への挿入は duplicate_new_id", () => {
    expect.hasAssertions();
    const existing = plannedNodeIdSchema.parse("n2");
    expect(() =>
      insertNode(graphWithTask(), {
        type: "insert_node",
        from: "start",
        to: "n1",
        newNode: { id: existing, title: titleOf("n2"), effect: "read_only" },
      }),
    ).toThrow(InsertNodePreconditionError);
  });
});

describe(reopen, () => {
  it("blocked ノードを resolution 必須で pending に戻し、ResolutionRecord を追記する", () => {
    expect.hasAssertions();
    const next = reopen(graphWithBlocked(), {
      type: "reopen",
      nodeId: "n1",
      resolution: nonEmptyStringSchema.parse("ユーザー決定: A案で進める"),
    });
    const n1 = findNode(next, "n1");
    expect(n1?.status).toBe("pending");
    if (n1?.kind !== "task") {
      throw new Error("kind は task であるべき");
    }
    expect(n1.resolutions).toHaveLength(1);
    expect(n1.resolutions[0]).toMatchObject({
      resolution: "ユーザー決定: A案で進める",
      previous: { phase: "execution", blockage: { kind: "worker_request" } },
    });
  });
});

describe("reopen は blocked 以外を not_blocked で拒否する", () => {
  it.each([
    [
      "done のノード",
      (): GraphV2["nodes"][number] => ({
        ...pendingReadOnly("n9"),
        status: "done",
        result: { kind: "read_only", summary: SUMMARY, data: null, completedBy: FENCE },
      }),
    ],
    ["pending のノード", (): GraphV2["nodes"][number] => pendingReadOnly("n9")],
    [
      "aborted のノード",
      (): GraphV2["nodes"][number] => ({
        ...pendingReadOnly("n9"),
        status: "aborted",
      }),
    ],
  ] as const)("%s は not_blocked で拒否される（v2 の対象は blocked のみ）", (_name, build) => {
    expect.hasAssertions();
    const base = createGraph("goal");
    const graph = { ...base, nodes: [...base.nodes, build()] };
    expect(() => reopen(graph, { type: "reopen", nodeId: "n9", resolution: SUMMARY })).toThrow(
      ReopenPreconditionError,
    );
  });

  it("boundary ノードは reopen できない", () => {
    expect.hasAssertions();
    expect(() =>
      reopen(createGraph("goal"), { type: "reopen", nodeId: "end", resolution: SUMMARY }),
    ).toThrow(ReopenPreconditionError);
  });
});

describe(abort, () => {
  it("pending ノードを aborted にする", () => {
    expect.hasAssertions();
    const base = createGraph("goal");
    const graph = { ...base, nodes: [...base.nodes, pendingReadOnly("n-pending")] };
    const next = abort(graph, { type: "abort", nodeId: "n-pending" });
    const node = findNode(next, "n-pending");
    expect(node?.status).toBe("aborted");
  });

  it("done ノードを aborted にすると payload は落ちる", () => {
    expect.hasAssertions();
    const base = createGraph("goal");
    const done = {
      ...pendingReadOnly("n-done"),
      status: "done",
      result: { kind: "read_only", summary: SUMMARY, data: null, completedBy: FENCE },
    } satisfies GraphV2["nodes"][number];
    const graph = { ...base, nodes: [...base.nodes, done] };
    const next = abort(graph, { type: "abort", nodeId: "n-done" });
    const node = findNode(next, "n-done");
    expect(node?.status).toBe("aborted");
    expect(node).not.toHaveProperty("result");
  });

  it("boundary ノードは abort できない", () => {
    expect.hasAssertions();
    expect(() => abort(createGraph("goal"), { type: "abort", nodeId: "start" })).toThrow(
      AbortPreconditionError,
    );
  });

  it("実行中系のノードは abort できない", () => {
    expect.hasAssertions();
    const running = {
      ...pendingReadOnly("r1", []),
      status: "running",
      assignment: readOnlyAssignmentOf("r1"),
    } satisfies GraphV2["nodes"][number];
    const base = createGraph("goal");
    const graph = { ...base, nodes: [...base.nodes, running] };
    expect(() => abort(graph, { type: "abort", nodeId: "r1" })).toThrow(AbortPreconditionError);
  });
});

describe(applyOperations, () => {
  it("操作列を適用して revision をちょうど 1 加算する", () => {
    expect.hasAssertions();
    const graph = graphWithTask();
    const next = applyOperations(graph, [
      {
        type: "insert_node",
        from: "start",
        to: "n1",
        newNode: { id: NEW_ID, title: titleOf("n-new"), effect: "read_only" },
      },
      { type: "abort", nodeId: "n2" },
    ]);
    expect(next.revision).toBe(graph.revision + 1);
    expect(findNode(next, "n2")?.status).toBe("aborted");
  });

  it("未知の操作種別は網羅性チェックで落ちる（fail-fast）", () => {
    expect.hasAssertions();
    // SAFETY: applyOperations の網羅性チェックが未知の type を拒否することを検証する、公開
    // API では構築できない意図的な不正値。GraphOperation のどの分岐とも構造的に重ならず
    // 二段の as が要る（TS2352）。schema.parse では弾かれ同じ検証ができないため as を使う。
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- 上記 SAFETY 参照。
    const invalidOperation = { type: "unknown_op" } as unknown as Parameters<
      typeof applyOperations
    >[1][number];
    expect(() => applyOperations(createGraph("goal"), [invalidOperation])).toThrow(
      /unknown operation type/u,
    );
  });
});
