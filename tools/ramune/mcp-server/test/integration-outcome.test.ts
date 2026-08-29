// ramune_record_integration_outcome の公開契約（§6.3 / §8）:
// success（publish_prepared の journal を完了証跡へ変換）/ 各失敗 blockage への遷移。
// conflict（機械挿入と chain 閉包）は integration-outcome-conflict.test.ts へ分割した。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import type { RecordIntegrationOutcomeInput } from "../src/tools/record-integration-outcome.ts";
import {
  callToolJson,
  expectDomainRejection,
  type TestClientHandle,
} from "./connect-test-client.ts";
import {
  CANONICAL_BEFORE,
  CANDIDATE,
  connectAndStart,
  findNode,
  INTEGRATED,
  insertTask,
  integrateUntilPublishPrepared,
  prepareCandidate,
  readGraph,
  toWireFence,
} from "./support.ts";
import type { AssignmentWire } from "./support.ts";

describe("ramune_record_integration_outcome: success", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("publish_prepared の journal を完了証跡に変換し、ノードを done にする", async () => {
    handle = await connectAndStart();
    await prepareCandidate(handle, "r1");
    const fence = await integrateUntilPublishPrepared(handle);

    const next = await callToolJson<GraphV2>(handle, "ramune_record_integration_outcome", {
      fence,
      outcome: { kind: "success" },
    });

    const r1 = findNode(next, "r1");
    expect(r1?.status).toBe("done");
    if (r1?.kind !== "task" || r1.effect !== "repository_change" || r1.status !== "done") {
      throw new Error("r1 は done な repository_change task のはず");
    }
    expect(r1.result).toMatchObject({
      kind: "integrated",
      integratedCommit: INTEGRATED,
      verification: { command: "mise run check", exitCode: 0 },
    });
    // done でも candidate は保持される（§2.7）
    expect(r1.candidate.commit).toBe(CANDIDATE);
  });

  it("merge_prepared 未満での success は拒否される", async () => {
    handle = await connectAndStart();
    await prepareCandidate(handle, "r1");
    const before = await readGraph(handle);
    const claimedIntegration = await callToolJson<{
      readonly journal: { readonly assignment: AssignmentWire };
    }>(handle, "ramune_claim_integration", {
      expected_revision: before.revision,
      canonical_head_before: CANONICAL_BEFORE,
    });

    const message = await expectDomainRejection(handle, "ramune_record_integration_outcome", {
      fence: toWireFence(claimedIntegration.journal.assignment),
      outcome: { kind: "success" },
    });

    expect(message).toContain("journal_not_publish_prepared");
  });
});

/** r1 を worker が提出し、Integrator が claim した直後の journal fence を返す。 */
async function setUpClaimedIntegrationFence(
  handle: TestClientHandle,
): Promise<ReturnType<typeof toWireFence>> {
  await insertTask(handle, "r1");
  const beforeClaim = await readGraph(handle);
  const claimed = await callToolJson<{
    readonly assignments: readonly AssignmentWire[];
  }>(handle, "ramune_claim_ready", {
    expected_revision: beforeClaim.revision,
    limit: 1,
    base_commit: CANONICAL_BEFORE,
  });
  const [fence] = claimed.assignments;
  if (!fence) {
    throw new Error("claim に失敗");
  }
  await callToolJson(handle, "ramune_submit_candidate", {
    fence: toWireFence(fence),
    commit: CANDIDATE,
    report: { summary: "作業報告", data: null },
  });
  const before = await readGraph(handle);
  const claimedIntegration = await callToolJson<{
    readonly journal: { readonly assignment: AssignmentWire };
  }>(handle, "ramune_claim_integration", {
    expected_revision: before.revision,
    canonical_head_before: CANONICAL_BEFORE,
  });
  return toWireFence(claimedIntegration.journal.assignment);
}

const FAILURE_OUTCOME_CASES = [
  [
    "verification_failed",
    (): RecordIntegrationOutcomeInput["outcome"] => ({
      kind: "verification_failed",
      reason: "check が失敗した",
      failure: {
        checked_commit: INTEGRATED,
        exit_code: 1,
        output_digest: "digest-fail",
        finished_at: "2026-08-24T01:00:00Z",
      },
      observed_git: {
        canonical_head: CANONICAL_BEFORE,
        canonical_worktree: "dirty",
        integration_workspace: "clean",
      },
    }),
  ],
  [
    "candidate_rejected",
    (): RecordIntegrationOutcomeInput["outcome"] => ({
      kind: "candidate_rejected",
      reason: "内容が要件を満たさない",
      code: "E_REQUIREMENT",
      evidence_digest: "digest-evidence",
    }),
  ],
  [
    "integration_state_uncertain",
    (): RecordIntegrationOutcomeInput["outcome"] => ({
      kind: "integration_state_uncertain",
      reason: "Git 状態を確定できない",
      observed_git: {
        canonical_head: INTEGRATED,
        canonical_worktree: "dirty",
        integration_workspace: "merge_in_progress",
      },
    }),
  ],
] as const;

describe("ramune_record_integration_outcome: 失敗経路", () => {
  let handle: TestClientHandle;
  let integrationFence: ReturnType<typeof toWireFence>;

  beforeEach(async () => {
    handle = await connectAndStart();
    integrationFence = await setUpClaimedIntegrationFence(handle);
  });

  afterEach(async () => {
    await handle.close();
  });

  it.each(FAILURE_OUTCOME_CASES)(
    "%s へ遷移するとき candidate は保持される",
    async (_name, buildOutcome) => {
      expect.hasAssertions();

      const next = await callToolJson<GraphV2>(handle, "ramune_record_integration_outcome", {
        fence: integrationFence,
        outcome: buildOutcome(),
      });

      const r1 = findNode(next, "r1");
      expect(r1?.status).toBe("blocked");
      if (
        r1?.kind !== "task" ||
        r1.effect !== "repository_change" ||
        r1.status !== "blocked" ||
        r1.phase !== "integration"
      ) {
        throw new Error("r1 は blocked な integration phase の repository_change task のはず");
      }
      expect(r1.candidate.commit).toBe(CANDIDATE);
    },
  );
});
