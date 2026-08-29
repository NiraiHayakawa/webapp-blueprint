// record_integration_outcome の公開契約（§6.3 / §8）:
// success（publish_prepared の journal を完了証跡へ変換）/ 各失敗 blockage への遷移。
// conflict（機械挿入と chain 閉包）は integration-outcome-conflict.test.ts へ分割した。
import { describe, expect, it } from "vitest";
import {
  advanceIntegration,
  claimIntegration,
  commitIdSchema,
  digestSchema,
  fenceOf,
  findNode,
  nonEmptyStringSchema,
  nonZeroExitCodeSchema,
  recordIntegrationOutcome,
  RecordIntegrationOutcomePreconditionError,
} from "../src/index.ts";
import type {
  AssignmentFence,
  FailedCheck,
  GitObservation,
  GraphV2,
  RecordIntegrationOutcomePreconditionViolation,
} from "../src/index.ts";
import {
  awaitingGraph,
  COMMIT_A,
  COMMIT_B,
  type GraphWithFence,
  T0,
  T1,
  WORKSPACE_INTEGRATION,
} from "./test-support.ts";

const REASON = nonEmptyStringSchema.parse("理由");
const DIGEST = digestSchema.parse("digest");
const CHECKED = commitIdSchema.parse("cccccccccccccccccccccccccccccccccccccccc");
const EXIT_CODE = nonZeroExitCodeSchema.parse(1);

const CLAIM_OP = {
  type: "claim_integration",
  workspaceId: WORKSPACE_INTEGRATION,
  startedAt: T0,
  canonicalHeadBefore: COMMIT_B,
} as const;

const FAILED_CHECK: FailedCheck = {
  command: "mise run check",
  checkedCommit: CHECKED,
  exitCode: EXIT_CODE,
  outputDigest: DIGEST,
  finishedAt: T1,
};

const OBSERVED_CLEAN: GitObservation = {
  canonicalHead: COMMIT_B,
  canonicalWorktree: "clean",
  integrationWorkspace: "clean",
};

function publishPrepared(): GraphWithFence {
  const claimed = claimIntegration(awaitingGraph(), CLAIM_OP);
  const fence = fenceOf(claimed.journal.assignment);
  const advanced = advanceIntegration(claimed.graph, {
    type: "advance_integration",
    fence,
    progress: { stage: "merge_prepared", integratedCommit: CHECKED },
  });
  const prepared = advanceIntegration(advanced, {
    type: "advance_integration",
    fence,
    progress: {
      stage: "publish_prepared",
      integratedCommit: CHECKED,
      verification: { checkedCommit: CHECKED, outputDigest: DIGEST, finishedAt: T1 },
    },
  });
  return { graph: prepared, fence };
}

function recordOutcome(
  graph: GraphV2,
  fence: AssignmentFence,
  outcome: Parameters<typeof recordIntegrationOutcome>[1]["outcome"],
): GraphV2 {
  return recordIntegrationOutcome(graph, {
    type: "record_integration_outcome",
    fence,
    outcome,
  });
}

/** run() が RecordIntegrationOutcomePreconditionError で拒否されることを前提に、その violation を返す。 */
function rejectedOutcomeViolation(
  run: () => GraphV2,
): RecordIntegrationOutcomePreconditionViolation {
  try {
    run();
  } catch (error) {
    if (error instanceof RecordIntegrationOutcomePreconditionError) {
      return error.violation;
    }
    throw error;
  }
  throw new Error("record_integration_outcome はエラーになるべき");
}

describe("recordIntegrationOutcome: success", () => {
  it("publish_prepared の journal を完了証跡に変換し、ノードを done にする", () => {
    expect.hasAssertions();
    const { graph, fence } = publishPrepared();
    const next = recordOutcome(graph, fence, { kind: "success" });
    const r1 = findNode(next, "r1");
    expect(r1?.status).toBe("done");
    if (r1?.kind !== "task" || r1.status !== "done" || r1.effect !== "repository_change") {
      throw new Error("r1 は done(repository_change) のはず");
    }
    expect(r1.result).toMatchObject({
      kind: "integrated",
      candidateCommit: COMMIT_A,
      integratedCommit: CHECKED,
      verification: { command: "mise run check", exitCode: 0 },
    });
    // done でも candidate は保持される（§2.7）
    expect(r1.candidate.commit).toBe(COMMIT_A);
  });

  it("publish_prepared に達していない journal での success は拒否される", () => {
    expect.hasAssertions();
    const claimed = claimIntegration(awaitingGraph(), CLAIM_OP);
    const violation = rejectedOutcomeViolation(() =>
      recordOutcome(claimed.graph, fenceOf(claimed.journal.assignment), { kind: "success" }),
    );
    expect(violation.reason).toBe("journal_not_publish_prepared");
  });
});

describe("recordIntegrationOutcome: failure paths", () => {
  it.each([
    [
      "verification_failed",
      (): Parameters<typeof recordOutcome>[2] => ({
        kind: "verification_failed",
        reason: REASON,
        failure: FAILED_CHECK,
        observedGit: OBSERVED_CLEAN,
      }),
    ],
    [
      "candidate_rejected",
      (): Parameters<typeof recordOutcome>[2] => ({
        kind: "candidate_rejected",
        reason: REASON,
        code: nonEmptyStringSchema.parse("E_TEST"),
        evidenceDigest: DIGEST,
      }),
    ],
    [
      "integration_state_uncertain",
      (): Parameters<typeof recordOutcome>[2] => ({
        kind: "integration_state_uncertain",
        reason: REASON,
        observedGit: OBSERVED_CLEAN,
      }),
    ],
  ] as const)("%s へ遷移するとき candidate は保持される", (_name, buildOutcome) => {
    expect.hasAssertions();
    const claimed = claimIntegration(awaitingGraph(), CLAIM_OP);
    const fence = fenceOf(claimed.journal.assignment);
    const next = recordOutcome(claimed.graph, fence, buildOutcome());
    const r1 = findNode(next, "r1");
    expect(r1?.status).toBe("blocked");
    if (
      r1?.kind !== "task" ||
      r1.effect !== "repository_change" ||
      r1.status !== "blocked" ||
      r1.phase !== "integration"
    ) {
      throw new Error("r1 は blocked(integration) のはず");
    }
    expect(r1.candidate.commit).toBe(COMMIT_A);
  });
});
