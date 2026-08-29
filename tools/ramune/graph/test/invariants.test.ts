// 不変条件（§2.8）の検出網羅。違反1件ずつを table-driven で確認する。
// グラフは公開操作では作れない形を含むため、直接組み立てる（テストフィクスチャ）。
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  allocationIdSchema,
  claimReady,
  createGraph,
  END_NODE_ID,
  findInvariantViolations,
  type GraphV2,
  type InvariantViolation,
  type PlannedNodeId,
  type RepositoryNode,
  type Revision,
} from "../src/index.ts";
import {
  COMMIT_A,
  pendingReadOnly,
  plannedId,
  pendingRepository,
  startedGraphWith,
  T0,
  WORKSPACE_1,
} from "./test-support.ts";

function graphOf(nodes: readonly GraphV2["nodes"][number][]): GraphV2 {
  const graph = createGraph("goal");
  return { ...graph, nodes: [...graph.nodes, ...nodes] };
}

/**
 * end_dependency / unsafe_number 不変条件の検出専用スキーマ。plannedNodeIdSchema /
 * revisionSchema は正規の値しか受け付けないが、この2つの不変条件は「型システムを
 * 迂回して不正な値がグラフに紛れ込んだ場合」を検出するためのものなので、ここでは
 * 意図的にその拒否を持たない別スキーマで parse する（型アサーションは使わない）。
 */
const endAsPlannedNodeId: PlannedNodeId = z
  .literal(END_NODE_ID)
  .brand<"PlannedNodeId">()
  .parse(END_NODE_ID);
const negativeRevision: Revision = z.number().brand<"Revision">().parse(-1);

function naughtyRepositoryDependingOnEnd(): RepositoryNode {
  return { ...pendingRepository("naughty", []), deps: [endAsPlannedNodeId] };
}

function graphWithNegativeRevision(): GraphV2 {
  return { ...createGraph("goal"), revision: negativeRevision };
}

const noViolationCases: readonly { readonly name: string; readonly graph: GraphV2 }[] = [
  { name: "start と end だけの初期グラフは違反を持たない", graph: createGraph("goal") },
  {
    name: "pending の task ノードを持つ通常のグラフは違反を持たない",
    graph: graphOf([pendingReadOnly("n1", ["start"]), pendingRepository("n2", ["n1"])]),
  },
];

const violationCases: readonly {
  readonly name: string;
  readonly graph: GraphV2;
  readonly expectedViolation: InvariantViolation;
}[] = [
  (() => {
    const dup = pendingReadOnly("n1");
    return {
      name: "同じ id のノードが2つあると duplicate_node_id",
      graph: graphOf([dup, { ...dup }, pendingRepository("n2", ["n1"])]),
      expectedViolation: { kind: "duplicate_node_id", id: "n1" },
    };
  })(),
  {
    name: "deps が存在しない id を参照すると dangling_dependency",
    graph: graphOf([pendingReadOnly("n1", ["ghost"])]),
    expectedViolation: { kind: "dangling_dependency", nodeId: "n1", missingDepId: "ghost" },
  },
  {
    name: "deps の重複は duplicate_dependency",
    graph: graphOf([
      pendingReadOnly("a"),
      pendingReadOnly("b", ["start"]),
      pendingRepository("c", ["a", "a"]),
    ]),
    expectedViolation: { kind: "duplicate_dependency", nodeId: "c", depId: "a" },
  },
  {
    name: "自己参照は self_dependency",
    graph: graphOf([pendingReadOnly("selfish", ["selfish"])]),
    expectedViolation: { kind: "self_dependency", nodeId: "selfish" },
  },
  {
    name: "互いに依存し合うノードがあると cycle",
    graph: graphOf([
      { ...pendingReadOnly("a"), deps: [plannedId("b")] },
      { ...pendingReadOnly("b"), deps: [plannedId("a")] },
    ]),
    expectedViolation: { kind: "cycle", cycle: ["a", "b", "a"] },
  },
  {
    name: "task ノードが end に依存すると end_dependency",
    graph: graphOf([naughtyRepositoryDependingOnEnd()]),
    expectedViolation: { kind: "end_dependency", nodeId: "naughty" },
  },
  {
    name: "start boundary が無いと missing_boundary_node",
    graph: ((): GraphV2 => {
      const graph = graphOf([]);
      return { ...graph, nodes: graph.nodes.filter((node) => node.id !== "start") };
    })(),
    expectedViolation: { kind: "missing_boundary_node", boundary: "start" },
  },
  {
    name: "revision が負になると unsafe_number",
    graph: graphWithNegativeRevision(),
    expectedViolation: {
      kind: "unsafe_number",
      field: "revision",
      value: -1,
      detail: "非負の safe integer でなければならない",
    },
  },
  {
    name: "allocator が発番済み ID を追い越すと allocator_behind_issued",
    graph: ((): GraphV2 => {
      // claim で assignmentId=1 を発番（nextAllocationId は 2 へ進む）後、
      // allocator を 1 へ巻き戻した状態を検査する
      const claimed = startedGraphWith([pendingRepository("r1")]);
      const result = claimReady(claimed, {
        type: "claim_ready",
        limit: 1,
        startedAt: T0,
        workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
      });
      return {
        ...result.graph,
        nextAllocationId: allocationIdSchema.parse(result.graph.nextAllocationId - 1),
      };
    })(),
    expectedViolation: {
      kind: "allocator_behind_issued",
      nextAllocationId: 1,
      maxIssuedId: 1,
    },
  },
];

describe("DAG 不変条件の検出（§2.8）", () => {
  it.each(noViolationCases)("$name", ({ graph }) => {
    expect.hasAssertions();
    expect(findInvariantViolations(graph)).toStrictEqual([]);
  });

  it.each(violationCases)("$name", ({ graph, expectedViolation }) => {
    expect.hasAssertions();
    // SAFETY: InvariantViolation の全バリアントは object 型であり、
    // expect.objectContaining の引数型を満たすための単純な widening。
    expect(findInvariantViolations(graph)).toContainEqual(
      expect.objectContaining(expectedViolation as object),
    );
  });
});

describe("allocator 台帳（§2.8: nextAllocationId は全発番 ID より大きい）", () => {
  it("発番後に allocator が追いついているグラフは違反を持たない", () => {
    expect.hasAssertions();
    // 正常系は各操作テストが finalizeTransaction を通ることで担保される
    const violations = findInvariantViolations(startedGraphWith([pendingReadOnly("n1")]));
    expect(violations.filter((v) => v.kind === "allocator_behind_issued")).toStrictEqual([]);
  });
});
