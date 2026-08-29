// selectReadyNodes（§3 の選択規約）の公開契約。
import { describe, expect, it } from "vitest";
import {
  assignmentIdSchema,
  blockageIdSchema,
  epochSchema,
  createGraph,
  selectReadyNodes,
  InvalidReadyLimitError,
  nonEmptyStringSchema,
  startSession,
  type GraphV2,
} from "../src/index.ts";
import { pendingReadOnly, plannedId, pendingRepository, RUN_ID, rev } from "./test-support.ts";

const READY_LIMIT_DEFAULT = 5;
const READY_LIMIT_MANY = 10;
const READY_LIMIT_ONE = 1;
const INVALID_LIMIT_FRACTIONAL = 1.5;

function startedGraphFixture(): GraphV2 {
  const graph = startSession(createGraph("goal"), { type: "start_session", runId: RUN_ID });
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      pendingReadOnly("n1", ["start"]),
      pendingReadOnly("n2", ["start"]),
      pendingRepository("n3", ["n1"]),
      {
        ...pendingReadOnly("n4", ["n2"]),
        status: "blocked",
        phase: "execution",
        blockage: {
          id: blockageIdSchema.parse(1),
          reason: nonEmptyStringSchema.parse("詰まった"),
          occurredAtRevision: rev(0),
          kind: "worker_request",
          assignment: {
            id: assignmentIdSchema.parse(1),
            nodeId: plannedId("n4"),
            runId: RUN_ID,
            epoch: epochSchema.parse(0),
          },
        },
      },
    ],
  };
}

describe(selectReadyNodes, () => {
  it("初期グラフでは start は boundary なので選ばれず、空配列を返す", () => {
    expect.hasAssertions();
    expect(selectReadyNodes(createGraph("goal"), READY_LIMIT_DEFAULT)).toStrictEqual([]);
  });

  it("pending かつ全 deps done のノードを宣言順に返す（blocked / 未完了の依存は除外）", () => {
    expect.hasAssertions();
    const ready = selectReadyNodes(startedGraphFixture(), READY_LIMIT_MANY).map((node) => node.id);
    // n3 は n1 待ち、n4 は blocked
    expect(ready).toStrictEqual(["n1", "n2"]);
  });

  it("limit 件で打ち切る", () => {
    expect.hasAssertions();
    expect(
      selectReadyNodes(startedGraphFixture(), READY_LIMIT_ONE).map((node) => node.id),
    ).toStrictEqual(["n1"]);
  });

  it.each([[0], [-1], [INVALID_LIMIT_FRACTIONAL]] as const)(
    "limit %s は InvalidReadyLimitError",
    (limit) => {
      expect.hasAssertions();
      expect(() => selectReadyNodes(createGraph("goal"), limit)).toThrow(InvalidReadyLimitError);
    },
  );
});
