// submit_candidate の公開契約（§6.1）。worker-operations.test.ts が
// claim_ready / record_result と合わせて 300 行を超えたための分割
// （max-lines 対応。挙動変更なし）。
import { describe, expect, it } from "vitest";
import {
  epochSchema,
  claimReady,
  createGraph,
  findNode,
  nonEmptyStringSchema,
  startSession,
  submitCandidate,
  SubmitCandidatePreconditionError,
} from "../src/index.ts";
import type { GraphV2 } from "../src/index.ts";
import { COMMIT_A, pendingRepository, RUN_ID, T0, WORKSPACE_1 } from "./test-support.ts";

const SUMMARY = nonEmptyStringSchema.parse("作業報告");
const STALE_EPOCH = 99;

function startedWithRepo(): GraphV2 {
  const base = createGraph("goal");
  return startSession(
    { ...base, nodes: [...base.nodes, pendingRepository("repo1", ["start"])] },
    { type: "start_session", runId: RUN_ID },
  );
}

// similarity-ignore: recordResultMarksReadOnlyDone（worker-operations.test.ts）と骨格が
// 似るのはテスト規約（claim → 操作 → toMatchObject）の必然であり、検証対象の公開契約
// （submit_candidate と record_result）は別物。統合すると契約単位のテストが崩れる。
function submitCandidateKeepsServerCopy(): void {
  expect.hasAssertions();
  const claimed = claimReady(startedWithRepo(), {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
    workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
  });
  const [assignment] = claimed.assignments;
  if (!assignment) {
    throw new Error("claim に失敗");
  }
  const next = submitCandidate(claimed.graph, {
    type: "submit_candidate",
    nodeId: "repo1",
    fence: assignment,
    commit: COMMIT_A,
    report: { summary: SUMMARY, data: null },
    submittedAt: T0,
  });
  const repo1 = findNode(next, "repo1");
  expect(repo1).toMatchObject({
    status: "awaiting_integration",
    candidate: { source: assignment, commit: COMMIT_A },
  });
}

function submitCandidateRejectsStaleFence(): void {
  expect.hasAssertions();
  const claimed = claimReady(startedWithRepo(), {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
    workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
  });
  const [assignment] = claimed.assignments;
  if (!assignment) {
    throw new Error("claim に失敗");
  }
  const oldEpochFence = {
    ...assignment,
    epoch: epochSchema.parse(STALE_EPOCH),
  };
  expect(() =>
    submitCandidate(claimed.graph, {
      type: "submit_candidate",
      nodeId: "repo1",
      fence: oldEpochFence,
      commit: COMMIT_A,
      report: { summary: SUMMARY, data: null },
      submittedAt: T0,
    }),
  ).toThrow(SubmitCandidatePreconditionError);
}

describe(submitCandidate, () => {
  it(
    "source はサーバコピーであり、candidate を保持した awaiting_integration になる",
    submitCandidateKeepsServerCopy,
  );

  it(
    "stale fence は拒否される（Worker の申告ではなく fence で認証する）",
    submitCandidateRejectsStaleFence,
  );
});
