// claim_ready / record_result / submit_candidate の公開契約（§3 / §6.1 / §8）。
import { describe, expect, it } from "vitest";
import {
  assignmentIdSchema,
  claimReady,
  ClaimReadyPreconditionError,
  createGraph,
  findNode,
  nonEmptyStringSchema,
  recordResult,
  RecordResultPreconditionError,
  startSession,
} from "../src/index.ts";
import type { GraphV2 } from "../src/index.ts";
import {
  COMMIT_A,
  fenceOfIds,
  pendingReadOnly,
  pendingRepository,
  RUN_ID,
  T0,
  WORKSPACE_1,
} from "./test-support.ts";

const SUMMARY = nonEmptyStringSchema.parse("作業報告");
const STALE_ASSIGNMENT_ID = 999;

function startedWithTasks(): GraphV2 {
  const base = createGraph("goal");
  return startSession(
    {
      ...base,
      nodes: [
        ...base.nodes,
        pendingReadOnly("ro1", ["start"]),
        pendingRepository("repo1", ["start"]),
        pendingReadOnly("ro2", ["start"]),
      ],
    },
    { type: "start_session", runId: RUN_ID },
  );
}

function startedWithRepoPending(): GraphV2 {
  const base = createGraph("goal");
  return startSession(
    { ...base, nodes: [...base.nodes, pendingRepository("repo1", ["start"])] },
    { type: "start_session", runId: RUN_ID },
  );
}

function claimSelectsFirstReadOnly(): void {
  expect.hasAssertions();
  const result = claimReady(startedWithTasks(), {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
  });
  expect(result.assignments).toHaveLength(1);
  const [assignment] = result.assignments;
  if (!assignment) {
    throw new Error("claim に失敗");
  }
  expect(assignment).toMatchObject({
    role: "worker",
    effect: "read_only",
    nodeId: "ro1",
    runId: RUN_ID,
    epoch: 0,
    id: 1,
  });
  const ro1 = findNode(result.graph, "ro1");
  expect(ro1?.status).toBe("running");
  expect(result.graph.nextAllocationId).toBe(2);
}

function claimConsumesWorkspacePool(): void {
  expect.hasAssertions();
  const result = claimReady(startedWithTasks(), {
    type: "claim_ready",
    limit: 3,
    startedAt: T0,
    workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
  });
  // 宣言順: ro1(read_only), repo1(repo), ro2(read_only)。
  // repo1 の worktree を消費し、その後ろの ro2 も継続して claim される
  const effects = result.assignments.map((a) => a.effect);
  expect(effects).toStrictEqual(["read_only", "repository_change", "read_only"]);
  const repo = findNode(result.graph, "repo1");
  expect(repo).toMatchObject({
    kind: "task",
    status: "running",
    assignment: {
      effect: "repository_change",
      workspaceId: WORKSPACE_1,
      baseCommit: COMMIT_A,
    },
  });
}

function claimStopsAtExhaustedPool(): void {
  expect.hasAssertions();
  const result = claimReady(startedWithTasks(), {
    type: "claim_ready",
    limit: 3,
    startedAt: T0,
    workspaces: [],
  });
  // 先頭の ro1 だけが claim され、worktree 必要な repo1 で止まる
  expect(result.assignments.map((a) => a.nodeId)).toStrictEqual(["ro1"]);
}

function claimRejectsSurplusWorkspaces(): void {
  expect.hasAssertions();
  expect(() =>
    claimReady(startedWithTasks(), {
      type: "claim_ready",
      limit: 10,
      startedAt: T0,
      workspaces: [
        { workspaceId: WORKSPACE_1, baseCommit: COMMIT_A },
        { workspaceId: WORKSPACE_1, baseCommit: COMMIT_A },
      ],
    }),
  ).toThrow(ClaimReadyPreconditionError);
}

function claimRejectsInactiveSession(): void {
  expect.hasAssertions();
  const graph = createGraph("goal");
  expect(() =>
    claimReady(
      { ...graph, nodes: [...graph.nodes, pendingReadOnly("x")] },
      {
        type: "claim_ready",
        limit: 1,
        startedAt: T0,
      },
    ),
  ).toThrow(ClaimReadyPreconditionError);
}

describe(claimReady, () => {
  it(
    "宣言順に選択し、read_only ノードには worktree 不要の assignment を発番する",
    claimSelectsFirstReadOnly,
  );

  it("repository_change ノードは workspaces プールを宣言順に消費する", claimConsumesWorkspacePool);

  it(
    "worktree 必要ノードでプールが尽きたら、そこで打ち切る（連続 prefix のみ claim）",
    claimStopsAtExhaustedPool,
  );

  it(
    "プールの余りは workspace_surplus で拒否する（黙って捨てない）",
    claimRejectsSurplusWorkspaces,
  );

  it("非稼働セッションでの claim は拒否される", claimRejectsInactiveSession);
});

// similarity-ignore: submitCandidateKeepsServerCopy（worker-operations-submit-candidate.test.ts）
// と骨格が似るのはテスト規約（claim → 操作 → toMatchObject）の必然であり、検証対象の
// 公開契約は別物。統合すると契約単位のテストが崩れる。
function recordResultMarksReadOnlyDone(): void {
  expect.hasAssertions();
  const claimed = claimReady(startedWithTasks(), {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
  });
  const [assignment] = claimed.assignments;
  if (!assignment) {
    throw new Error("claim に失敗");
  }
  const next = recordResult(claimed.graph, {
    type: "record_result",
    nodeId: assignment.nodeId,
    fence: assignment,
    report: { summary: SUMMARY, data: { found: 42 } },
  });
  const node = findNode(next, assignment.nodeId);
  expect(node).toMatchObject({
    status: "done",
    result: {
      kind: "read_only",
      completedBy: { id: assignment.id, nodeId: assignment.nodeId },
    },
  });
}

function recordResultRejectsStaleFence(): void {
  expect.hasAssertions();
  const claimed = claimReady(startedWithTasks(), {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
  });
  const [assignment] = claimed.assignments;
  if (!assignment) {
    throw new Error("claim に失敗");
  }
  const wrongFence = { ...assignment, id: assignmentIdSchema.parse(STALE_ASSIGNMENT_ID) };
  expect(() =>
    recordResult(claimed.graph, {
      type: "record_result",
      nodeId: assignment.nodeId,
      fence: wrongFence,
      report: { summary: SUMMARY, data: null },
    }),
  ).toThrow(RecordResultPreconditionError);
}

function recordResultRejectsRepositoryNode(): void {
  expect.hasAssertions();
  const graph = startedWithRepoPending();
  expect(() =>
    recordResult(graph, {
      type: "record_result",
      nodeId: "repo1",
      fence: fenceOfIds(1, "repo1"),
      report: { summary: SUMMARY, data: null },
    }),
  ).toThrow(RecordResultPreconditionError);
}

describe(recordResult, () => {
  it(
    "read_only ノードを running -> done にし、completedBy 付きの結果を書く",
    recordResultMarksReadOnlyDone,
  );

  it(
    "stale fence（assignmentId 不一致）は stale_fence で拒否される",
    recordResultRejectsStaleFence,
  );

  it("repository_change ノードには使えない", recordResultRejectsRepositoryNode);
});

// submit_candidate のケースは worker-operations-submit-candidate.test.ts に分割
// （このファイルが max-lines を超えたため。挙動変更なし）。
