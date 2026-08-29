// claim_integration / advance_integration の公開契約（§6.2 / §8）。
import { describe, expect, it } from "vitest";
import {
  advanceIntegration,
  AdvanceIntegrationPreconditionError,
  claimIntegration,
  ClaimIntegrationPreconditionError,
  commitIdSchema,
  createGraph,
  digestSchema,
  assignmentIdSchema,
  fenceOf,
  findNode,
  startSession,
  type AdvanceIntegrationPreconditionViolation,
  type AssignmentFence,
  type CommitId,
  type GraphV2,
} from "../src/index.ts";
import {
  awaitingGraph,
  COMMIT_A,
  COMMIT_B,
  RUN_ID,
  T0,
  T1,
  WORKSPACE_INTEGRATION,
} from "./test-support.ts";

const DIGEST = digestSchema.parse("digest");
const CHECKED = commitIdSchema.parse("cccccccccccccccccccccccccccccccccccccccc");
const STALE_ASSIGNMENT_OFFSET = 999;

const CLAIM_OP = {
  type: "claim_integration",
  workspaceId: WORKSPACE_INTEGRATION,
  startedAt: T0,
  canonicalHeadBefore: COMMIT_B,
} as const;

function startedOnly(): GraphV2 {
  const base = createGraph("goal");
  return startSession(base, { type: "start_session", runId: RUN_ID });
}

function claimedIntegration(graph: GraphV2) {
  const result = claimIntegration(graph, CLAIM_OP);
  return { graph: result.graph, fence: fenceOf(result.journal.assignment) };
}

function mergePreparedOp(fence: AssignmentFence) {
  return {
    type: "advance_integration",
    fence,
    progress: { stage: "merge_prepared", integratedCommit: CHECKED },
  } as const;
}

function publishPreparedOp(fence: AssignmentFence, checkedCommit: CommitId) {
  return {
    type: "advance_integration",
    fence,
    progress: {
      stage: "publish_prepared",
      integratedCommit: CHECKED,
      verification: { checkedCommit, outputDigest: DIGEST, finishedAt: T1 },
    },
  } as const;
}

const EXPECTED_PUBLISH_PREPARED_PROGRESS = {
  stage: "publish_prepared",
  integratedCommit: CHECKED,
  verification: {
    command: "mise run check",
    exitCode: 0,
    checkedCommit: CHECKED,
    outputDigest: DIGEST,
    finishedAt: T1,
  },
} as const;

/** run() が AdvanceIntegrationPreconditionError で拒否されることを前提に、その violation を返す。 */
function rejectedAdvanceViolation(run: () => GraphV2): AdvanceIntegrationPreconditionViolation {
  try {
    run();
  } catch (error) {
    if (error instanceof AdvanceIntegrationPreconditionError) {
      return error.violation;
    }
    throw error;
  }
  throw new Error("advance_integration はエラーになるべき");
}

describe(claimIntegration, () => {
  it("awaiting_integration を1件だけ integrating にし、journal（claimed）を書く", () => {
    expect.hasAssertions();
    const result = claimIntegration(awaitingGraph(), CLAIM_OP);
    const r1 = findNode(result.graph, "r1");
    expect(r1?.status).toBe("integrating");
    if (r1?.kind !== "task" || r1.status !== "integrating") {
      throw new Error("r1 は integrating のはず");
    }
    expect(r1.integration).toMatchObject({
      candidateCommit: COMMIT_A,
      canonicalHeadBefore: COMMIT_B,
      progress: { stage: "claimed" },
    });
    expect(r1.integration.assignment).toMatchObject({
      role: "integrator",
      nodeId: "r1",
      runId: RUN_ID,
      epoch: 0,
    });
    expect(result.journal.candidateCommit).toBe(COMMIT_A);
  });

  it("統合可能候補が無ければ no_integratable_candidate", () => {
    expect.hasAssertions();
    expect(() => claimIntegration(startedOnly(), CLAIM_OP)).toThrow(
      ClaimIntegrationPreconditionError,
    );
  });

  it("非稼働セッションでは拒否される", () => {
    expect.hasAssertions();
    expect(() => claimIntegration(createGraph("goal"), CLAIM_OP)).toThrow(
      ClaimIntegrationPreconditionError,
    );
  });
});

describe(advanceIntegration, () => {
  it("journal を claimed -> merge_prepared -> publish_prepared と進められる", () => {
    expect.hasAssertions();
    const { graph, fence } = claimedIntegration(awaitingGraph());
    const merged = advanceIntegration(graph, mergePreparedOp(fence));
    const advanced = advanceIntegration(merged, publishPreparedOp(fence, CHECKED));
    const r1 = findNode(advanced, "r1");
    if (r1?.kind !== "task" || r1.status !== "integrating") {
      throw new Error("r1 は integrating のはず");
    }
    expect(r1.integration.progress).toStrictEqual(EXPECTED_PUBLISH_PREPARED_PROGRESS);
  });

  it("claimed から publish_prepared へ直接は進めない（段階順序の強制）", () => {
    expect.hasAssertions();
    const { graph, fence } = claimedIntegration(awaitingGraph());
    const violation = rejectedAdvanceViolation(() =>
      advanceIntegration(graph, publishPreparedOp(fence, CHECKED)),
    );
    expect(violation.reason).toBe("invalid_stage_order");
  });

  it("検証対象 commit が integratedCommit と不一致の証跡では publish_prepared に進めない", () => {
    expect.hasAssertions();
    const { graph, fence } = claimedIntegration(awaitingGraph());
    const merged = advanceIntegration(graph, mergePreparedOp(fence));
    const violation = rejectedAdvanceViolation(() =>
      advanceIntegration(merged, publishPreparedOp(fence, COMMIT_A)),
    );
    expect(violation.reason).toBe("verification_commit_mismatch");
  });

  it("stale fence は拒否される", () => {
    expect.hasAssertions();
    const { graph, fence } = claimedIntegration(awaitingGraph());
    const stale = {
      ...fence,
      id: assignmentIdSchema.parse(fence.id + STALE_ASSIGNMENT_OFFSET),
    };
    expect(() => advanceIntegration(graph, mergePreparedOp(stale))).toThrow(
      AdvanceIntegrationPreconditionError,
    );
  });
});
