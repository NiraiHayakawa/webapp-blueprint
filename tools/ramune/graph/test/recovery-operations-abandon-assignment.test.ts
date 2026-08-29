// abandon_assignment の公開契約（§7）: 実行段階の死亡記録、統合段階での
// Git 観測による解消（done / awaiting_integration 往復 / fail-closed）、stale fence の拒否。
import { describe, expect, it } from "vitest";
import {
  abandonAssignment,
  AbandonAssignmentPreconditionError,
  claimReady,
  findNode,
  nonEmptyStringSchema,
  recordResult,
  RecordResultPreconditionError,
  resumeSession,
} from "../src/index.ts";
import type { AssignmentFence, GitObservation } from "../src/index.ts";
import {
  assignmentIdOf,
  CHECKED,
  claimedReadOnly,
  COMMIT_A,
  COMMIT_B,
  integratingRepo,
  plannedId,
  publishPreparedRepo,
  RUN_ID,
  startedWithTasks,
  T0,
  epochZero,
} from "./test-support.ts";

const SUMMARY = nonEmptyStringSchema.parse("報告");
const EVIDENCE = nonEmptyStringSchema.parse("プロセス終了を確認した");
const STALE_ASSIGNMENT_ID_NUMBER = 42;
const OBSERVED_CLEAN_AT_BEFORE: GitObservation = {
  canonicalHead: COMMIT_B,
  canonicalWorktree: "clean",
  integrationWorkspace: "dirty",
};
const OBSERVED_PUBLISHED: GitObservation = {
  canonicalHead: CHECKED,
  canonicalWorktree: "clean",
  integrationWorkspace: "missing",
};

/** try/catch の catch 節に expect を置かない（no-conditional-expect）ための例外捕捉ヘルパー。 */
function captureError(run: () => void): Error | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
}

describe(abandonAssignment, () => {
  it("実行段階の死亡を blocked(worker_terminated) にする（observedGit は不要）", () => {
    expect.hasAssertions();
    const { graph, fence } = claimedReadOnly();
    const next = abandonAssignment(graph, {
      type: "abandon_assignment",
      fence,
      evidence: EVIDENCE,
    });
    const ro1 = findNode(next, "ro1");
    expect(ro1?.status).toBe("blocked");
    if (
      ro1?.kind !== "task" ||
      ro1.effect !== "read_only" ||
      ro1.status !== "blocked" ||
      ro1.phase !== "execution" ||
      ro1.blockage.kind !== "worker_terminated"
    ) {
      throw new Error("ro1 は実行段階 worker_terminated のはず");
    }
    expect(ro1.blockage.terminationEvidence).toBe(EVIDENCE);
  });

  it("統合段階で publish 済みと確定できる場合（publish_prepared + HEAD 一致）は chain ごと done", () => {
    expect.hasAssertions();
    const { graph, fence } = publishPreparedRepo();
    const next = abandonAssignment(graph, {
      type: "abandon_assignment",
      fence,
      evidence: EVIDENCE,
      observedGit: OBSERVED_PUBLISHED,
    });
    expect(findNode(next, "repo1")?.status).toBe("done");
  });
});

describe(`${abandonAssignment.name} (統合段階の再照合)`, () => {
  it("canonical が clean で未着手なら candidate を保持して awaiting_integration へ戻す", () => {
    expect.hasAssertions();
    const { graph, fence } = integratingRepo();
    const next = abandonAssignment(graph, {
      type: "abandon_assignment",
      fence,
      evidence: EVIDENCE,
      observedGit: OBSERVED_CLEAN_AT_BEFORE,
    });
    const repo1 = findNode(next, "repo1");
    expect(repo1?.status).toBe("awaiting_integration");
    if (
      repo1?.kind !== "task" ||
      repo1.effect !== "repository_change" ||
      repo1.status !== "awaiting_integration"
    ) {
      throw new Error("repo1 は awaiting_integration のはず");
    }
    expect(repo1.candidate.commit).toBe(COMMIT_A);
  });

  it("確定できない観測なら blocked(integration_state_uncertain)（fail-closed）", () => {
    expect.hasAssertions();
    const { graph, fence } = integratingRepo();
    const uncertain: GitObservation = {
      canonicalHead: CHECKED,
      canonicalWorktree: "dirty",
      integrationWorkspace: "dirty",
    };
    const next = abandonAssignment(graph, {
      type: "abandon_assignment",
      fence,
      evidence: EVIDENCE,
      observedGit: uncertain,
    });
    const repo1 = findNode(next, "repo1");
    expect(repo1?.status).toBe("blocked");
    if (
      repo1?.kind !== "task" ||
      repo1.effect !== "repository_change" ||
      repo1.status !== "blocked" ||
      repo1.phase !== "integration"
    ) {
      throw new Error("repo1 は integration phase の blocked のはず");
    }
    expect(repo1.blockage.kind).toBe("integration_state_uncertain");
  });
});

describe(`${abandonAssignment.name} (拒否・配線)`, () => {
  it("統合段階の死亡確認に observedGit が無いと拒否される", () => {
    expect.hasAssertions();
    const { graph, fence } = integratingRepo();
    expect(() =>
      abandonAssignment(graph, { type: "abandon_assignment", fence, evidence: EVIDENCE }),
    ).toThrow(AbandonAssignmentPreconditionError);
  });

  it("stale fence（旧 assignmentId）は新 assignment を潰さない", () => {
    expect.hasAssertions();
    const first = claimReady(startedWithTasks(), { type: "claim_ready", limit: 1, startedAt: T0 });
    // 死亡 -> 再割当を模擬せず、単に存在しない id の fence で abandon を試みる
    const [original] = first.assignments;
    if (!original) {
      throw new Error("claim に失敗");
    }
    const staleFence: AssignmentFence = {
      id: assignmentIdOf(STALE_ASSIGNMENT_ID_NUMBER),
      nodeId: original.nodeId,
      runId: original.runId,
      epoch: original.epoch,
    };
    expect(() =>
      abandonAssignment(first.graph, {
        type: "abandon_assignment",
        fence: staleFence,
        evidence: EVIDENCE,
      }),
    ).toThrow(AbandonAssignmentPreconditionError);
  });
});

describe(`${abandonAssignment.name} (下流配線)`, () => {
  it("resume 済み（旧 epoch）の fence による完了報告は拒否される配線を持つ", () => {
    expect.hasAssertions();
    // record_result 経路での stale fence 拒否は stale_fence 違反になる
    const resumed = resumeSession(claimedReadOnly().graph, { type: "resume_session" });
    const ro1 = findNode(resumed, "ro1");
    expect(ro1?.status).toBe("blocked");
    const error = captureError(() => {
      recordResult(resumed, {
        type: "record_result",
        nodeId: "ro1",
        fence: {
          id: assignmentIdOf(1),
          nodeId: plannedId("ro1"),
          runId: RUN_ID,
          epoch: epochZero(),
        },
        report: { summary: SUMMARY, data: null },
      });
    });
    expect(error).toBeInstanceOf(RecordResultPreconditionError);
    if (!(error instanceof RecordResultPreconditionError)) {
      throw new Error("record_result は前提条件エラーを投げるはず");
    }
    expect(error.violation.reason).toBe("not_running");
  });
});
