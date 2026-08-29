// resume_session の公開契約（§7）: epoch の加算と running ノードの blocked(session_resumed) 化、
// integrating ノード存在時の拒否（照合の機会の保護）、awaiting_integration の不 touch。
import { describe, expect, it } from "vitest";
import {
  abandonAssignment,
  claimReady,
  createGraph,
  findNode,
  nonEmptyStringSchema,
  resumeSession,
  ResumeSessionPreconditionError,
  startSession,
  submitCandidate,
} from "../src/index.ts";
import {
  assignmentIdOf,
  COMMIT_A,
  COMMIT_B,
  integratingRepo,
  pendingRepository,
  RUN_ID,
  startedWithTasks,
  T0,
  WORKSPACE_1,
} from "./test-support.ts";

const SUMMARY = nonEmptyStringSchema.parse("報告");
const EVIDENCE = nonEmptyStringSchema.parse("プロセス終了を確認した");

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

describe(resumeSession, () => {
  it("epoch を +1 し、running ノードを blocked(session_resumed) にする", () => {
    expect.hasAssertions();
    const running = claimReady(startedWithTasks(), {
      type: "claim_ready",
      limit: 1,
      startedAt: T0,
    }).graph;
    const resumed = resumeSession(running, { type: "resume_session" });
    expect(resumed.session).toStrictEqual({ state: "active", runId: RUN_ID, epoch: 1 });
    const ro1 = findNode(resumed, "ro1");
    expect(ro1?.status).toBe("blocked");
  });

  it("session_resumed blockage には新しい blockageId が発番され、resumedToEpoch が入る", () => {
    expect.hasAssertions();
    const running = claimReady(startedWithTasks(), {
      type: "claim_ready",
      limit: 1,
      startedAt: T0,
    }).graph;
    const resumed = resumeSession(running, { type: "resume_session" });
    const ro1 = findNode(resumed, "ro1");
    if (
      ro1?.kind !== "task" ||
      ro1.effect !== "read_only" ||
      ro1.status !== "blocked" ||
      ro1.phase !== "execution" ||
      ro1.blockage.kind !== "session_resumed"
    ) {
      throw new Error("ro1 は実行段階 blocked のはず");
    }
    expect(ro1.blockage.resumedToEpoch).toBe(1);
    expect(ro1.blockage.assignment.id).toBe(assignmentIdOf(1));
  });
});

describe(`${resumeSession.name} (awaiting_integration)`, () => {
  it("awaiting_integration ノードは触らない（candidate 保持のみで live ではない）", () => {
    expect.hasAssertions();
    const base = createGraph("goal");
    const started = startSession(
      { ...base, nodes: [...base.nodes, pendingRepository("repo1", ["start"])] },
      { type: "start_session", runId: RUN_ID },
    );
    const workerClaim = claimReady(started, {
      type: "claim_ready",
      limit: 1,
      startedAt: T0,
      workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
    });
    const [workerFence] = workerClaim.assignments;
    if (!workerFence) {
      throw new Error("フィクスチャ構築に失敗");
    }
    const awaiting = submitCandidate(workerClaim.graph, {
      type: "submit_candidate",
      nodeId: "repo1",
      fence: workerFence,
      commit: COMMIT_A,
      report: { summary: SUMMARY, data: null },
      submittedAt: T0,
    });
    const resumed = resumeSession(awaiting, { type: "resume_session" });
    expect(findNode(resumed, "repo1")?.status).toBe("awaiting_integration");
  });
});

describe(`${resumeSession.name} (integrating 拒否。照合の機会を resume が破壊しない。§7)`, () => {
  it("integrating ノードが存在するときは ResumeSessionPreconditionError を投げる", () => {
    expect.hasAssertions();
    const { graph } = integratingRepo();
    const error = captureError(() => {
      resumeSession(graph, { type: "resume_session" });
    });
    expect(error).toBeInstanceOf(ResumeSessionPreconditionError);
    if (!(error instanceof ResumeSessionPreconditionError)) {
      throw new Error("resume_session は前提条件エラーを投げるはず");
    }
    const { violation } = error;
    expect(violation.reason).toBe("integrating_node_exists");
  });

  it("integrating_node_exists の violation は対象ノード id を含む", () => {
    expect.hasAssertions();
    const { graph } = integratingRepo();
    const error = captureError(() => {
      resumeSession(graph, { type: "resume_session" });
    });
    if (!(error instanceof ResumeSessionPreconditionError)) {
      throw new Error("resume_session は前提条件エラーを投げるはず");
    }
    const { violation } = error;
    if (violation.reason !== "integrating_node_exists") {
      throw new Error("violation は integrating_node_exists のはず");
    }
    expect(violation.nodeIds).toContain("repo1");
  });

  it("integrating ノードが存在するとき、resume はグラフを変更しない（candidate / journal は保持される）", () => {
    expect.hasAssertions();
    const { graph } = integratingRepo();
    captureError(() => {
      resumeSession(graph, { type: "resume_session" });
    });
    const repo1 = findNode(graph, "repo1");
    expect(repo1?.status).toBe("integrating");
  });
});

describe(`${resumeSession.name} (再照合・非稼働)`, () => {
  it("abandon 照合で integrating を解消した後なら resume できる", () => {
    expect.hasAssertions();
    const { graph, fence } = integratingRepo();
    const reconciled = abandonAssignment(graph, {
      type: "abandon_assignment",
      fence,
      evidence: EVIDENCE,
      observedGit: {
        canonicalHead: COMMIT_B,
        canonicalWorktree: "clean",
        integrationWorkspace: "clean",
      },
    });
    // 未着手 clean のため repo1 は awaiting_integration へ戻る
    expect(findNode(reconciled, "repo1")?.status).toBe("awaiting_integration");
    const resumed = resumeSession(reconciled, { type: "resume_session" });
    expect(resumed.session).toStrictEqual({ state: "active", runId: RUN_ID, epoch: 1 });
    expect(findNode(resumed, "repo1")?.status).toBe("awaiting_integration");
  });

  it("非稼働セッションでは拒否される", () => {
    expect.hasAssertions();
    expect(() => resumeSession(createGraph("goal"), { type: "resume_session" })).toThrow(
      ResumeSessionPreconditionError,
    );
  });
});
