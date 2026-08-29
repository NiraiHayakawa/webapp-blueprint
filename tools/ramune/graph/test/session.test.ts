// start_session / end_session の公開契約（boundary の機械遷移を含む。§2.1 / §8）。
import { describe, expect, it } from "vitest";
import {
  claimReady,
  createGraph,
  endSession,
  EndSessionPreconditionError,
  findNode,
  nonEmptyStringSchema,
  startSession,
  StartSessionPreconditionError,
  submitCandidate,
  type GraphV2,
} from "../src/index.ts";
import { COMMIT_A, plannedId, pendingRepository, RUN_ID, T0, WORKSPACE_1 } from "./test-support.ts";

const SUMMARY = nonEmptyStringSchema.parse("作業報告");

function startedWithRepoTask(): GraphV2 {
  const base = createGraph("goal");
  return startSession(
    { ...base, nodes: [...base.nodes, pendingRepository("r1", ["start"])] },
    { type: "start_session", runId: RUN_ID },
  );
}

/** startedWithRepoTask から r1 を claim（running）まで進めたグラフ。 */
function runningTaskGraph(): GraphV2 {
  const claimed = claimReady(startedWithRepoTask(), {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
    workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
  });
  return claimed.graph;
}

/** r1 を awaiting_integration まで進めたグラフ。 */
function awaitingTaskGraph(): GraphV2 {
  const graph = runningTaskGraph();
  const node = findNode(graph, "r1");
  if (node?.kind !== "task" || node.status !== "running") {
    throw new Error("フィクスチャ構築に失敗");
  }
  return submitCandidate(graph, {
    type: "submit_candidate",
    nodeId: "r1",
    fence: {
      id: node.assignment.id,
      nodeId: node.id,
      runId: node.assignment.runId,
      epoch: node.assignment.epoch,
    },
    commit: COMMIT_A,
    report: { summary: SUMMARY, data: null },
    submittedAt: T0,
  });
}

/**
 * endSession が投げる EndSessionPreconditionError を取り出す（投げなければ undefined）。
 * それ以外の例外は握りつぶさず再送出する。
 */
function captureEndSessionError(run: () => void): EndSessionPreconditionError | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (!(error instanceof EndSessionPreconditionError)) {
      throw error;
    }
    return error;
  }
}

function endsSessionAndFinishesEndBoundary(): void {
  expect.hasAssertions();
  // 初期グラフの end.deps は ["start"]。start はセッション開始で done 済み
  const active = startSession(createGraph("goal"), { type: "start_session", runId: RUN_ID });
  const next = endSession(active, { type: "end_session" });
  expect(next.session).toStrictEqual({ state: "inactive" });
  expect(findNode(next, "end")?.status).toBe("done");
}

function leavesEndPendingWhenDepsUnfinished(): void {
  expect.hasAssertions();
  const base = createGraph("goal");
  // end.deps を未完了 task へ付け替えたグラフ
  const endNode = base.nodes.at(-1);
  if (endNode?.kind !== "boundary" || endNode.boundary !== "end" || endNode.status !== "pending") {
    throw new Error("フィクスチャ構築に失敗");
  }
  const withTask: GraphV2 = {
    ...base,
    nodes: [
      ...base.nodes.slice(0, -1),
      pendingRepository("r1", ["start"]),
      { ...endNode, deps: [plannedId("r1")] },
    ],
  };
  const active = startSession(withTask, { type: "start_session", runId: RUN_ID });
  const next = endSession(active, { type: "end_session" });
  expect(findNode(next, "end")?.status).toBe("pending");
  expect(next.session).toStrictEqual({ state: "inactive" });
}

describe(startSession, () => {
  it("session を稼働にし（epoch 0）、start boundary を runId 付きで done にする", () => {
    expect.hasAssertions();
    const next = startSession(createGraph("goal"), { type: "start_session", runId: RUN_ID });
    expect(next.session).toStrictEqual({ state: "active", runId: RUN_ID, epoch: 0 });
    const start = findNode(next, "start");
    expect(start).toMatchObject({
      kind: "boundary",
      status: "done",
      result: { kind: "boundary", runId: RUN_ID },
    });
  });

  it("すでに稼働している場合は already_active", () => {
    expect.hasAssertions();
    const active = startSession(createGraph("goal"), { type: "start_session", runId: RUN_ID });
    expect(() => startSession(active, { type: "start_session", runId: RUN_ID })).toThrow(
      StartSessionPreconditionError,
    );
  });

  it("2 回目の開始でも過去の start 証跡は壊れない", () => {
    expect.hasAssertions();
    const first = startSession(createGraph("goal"), { type: "start_session", runId: RUN_ID });
    const ended = endSession(first, { type: "end_session" });
    const second = startSession(ended, { type: "start_session", runId: RUN_ID });
    expect(findNode(second, "start")?.status).toBe("done");
  });
});

describe(endSession, () => {
  it(
    "実行中ノードが無く end の deps が揃っていれば、非稼働化と同時に end を done にする",
    endsSessionAndFinishesEndBoundary,
  );

  it(
    "end の deps が未完了なら end は pending のまま非稼働になる（嘘の証跡を書かない）",
    leavesEndPendingWhenDepsUnfinished,
  );

  it("running ノードがあれば unfinished_nodes_exist で拒否される", () => {
    expect.hasAssertions();
    const error = captureEndSessionError(() => {
      endSession(runningTaskGraph(), { type: "end_session" });
    });
    expect(error?.violation).toMatchObject({
      reason: "unfinished_nodes_exist",
      nodeIds: ["r1"],
    });
  });

  it("awaiting_integration ノードがあれば unfinished_nodes_exist で拒否される", () => {
    expect.hasAssertions();
    const error = captureEndSessionError(() => {
      endSession(awaitingTaskGraph(), { type: "end_session" });
    });
    expect(error?.violation).toMatchObject({
      reason: "unfinished_nodes_exist",
      nodeIds: ["r1"],
    });
  });

  it("非稼働で呼ぶと already_inactive", () => {
    expect.hasAssertions();
    expect(() => endSession(createGraph("goal"), { type: "end_session" })).toThrow(
      EndSessionPreconditionError,
    );
  });
});
