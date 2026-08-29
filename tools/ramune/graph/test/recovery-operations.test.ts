// request_replan の公開契約（§7 / §8）: running / integrating ノードを
// blocked(worker_request) / blocked(integration_replan_requested) へ遷移させ、
// fence の一致しないノードは拒否する。
//
// abandon_assignment は recovery-operations-abandon-assignment.test.ts、
// resume_session は recovery-operations-resume-session.test.ts へ分割した。
import { describe, expect, it } from "vitest";
import {
  epochSchema,
  findNode,
  nonEmptyStringSchema,
  requestReplan,
  RequestReplanPreconditionError,
} from "../src/index.ts";
import {
  assignmentIdOf,
  claimedReadOnly,
  COMMIT_A,
  epochZero,
  integratingRepo,
  plannedId,
  RUN_ID,
  startedWithTasks,
} from "./test-support.ts";

const STALE_EPOCH_NUMBER = 99;
const STALE_EPOCH = epochSchema.parse(STALE_EPOCH_NUMBER);

describe(requestReplan, () => {
  it("running ノードの Worker を blocked(worker_request) にする（fence を証跡として保持）", () => {
    expect.hasAssertions();
    const { graph, fence } = claimedReadOnly();
    const next = requestReplan(graph, {
      type: "request_replan",
      fence,
      reason: nonEmptyStringSchema.parse("仕様が決まっていない"),
    });
    const ro1 = findNode(next, "ro1");
    expect(ro1?.status).toBe("blocked");
    if (ro1?.kind !== "task" || ro1.status !== "blocked") {
      throw new Error("ro1 は blocked のはず");
    }
    expect(ro1.blockage.kind).toBe("worker_request");
  });

  it("integrating ノードの Integrator を blocked(integration_replan_requested) にする（candidate 保持）", () => {
    expect.hasAssertions();
    const { graph, fence } = integratingRepo();
    const next = requestReplan(graph, {
      type: "request_replan",
      fence,
      reason: nonEmptyStringSchema.parse("統合方針を決めたい"),
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
    expect(repo1.candidate.commit).toBe(COMMIT_A);
  });
});

describe(`${requestReplan.name} (拒否系)`, () => {
  it("stale fence は拒否される", () => {
    expect.hasAssertions();
    const { graph, fence } = claimedReadOnly();
    expect(() =>
      requestReplan(graph, {
        type: "request_replan",
        fence: { ...fence, epoch: STALE_EPOCH },
        reason: nonEmptyStringSchema.parse("x"),
      }),
    ).toThrow(RequestReplanPreconditionError);
  });

  it("pending ノード（誰も claim していない）は拒否される", () => {
    expect.hasAssertions();
    expect(() =>
      requestReplan(startedWithTasks(), {
        type: "request_replan",
        fence: {
          id: assignmentIdOf(1),
          nodeId: plannedId("ro1"),
          runId: RUN_ID,
          epoch: epochZero(),
        },
        reason: nonEmptyStringSchema.parse("x"),
      }),
    ).toThrow(RequestReplanPreconditionError);
  });
});
