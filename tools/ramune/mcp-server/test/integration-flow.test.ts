// 統合系ツールの公開契約（§6.2 / §6.3 / §8）:
// ramune_claim_integration / ramune_advance_integration / ramune_record_integration_outcome。
// journal 段階の強制、conflict での解消ノード機械挿入、success での chain 同時 done、
// 失敗 blockage への遷移を含む。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import {
  callToolJson,
  expectDomainRejection,
  type TestClientHandle,
} from "./connect-test-client.ts";
import {
  connectAndStart,
  insertTask,
  readGraph,
  toWireFence,
  type AssignmentFenceWire,
} from "./support.ts";

const CANONICAL_BEFORE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const INTEGRATED = "cccccccccccccccccccccccccccccccccccccccc";
const DIGEST = "digest-1";
const BASE_COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

interface IntegrationClaimWire {
  readonly graph: GraphV2;
  readonly journal: {
    readonly assignment: {
      readonly id: number;
      readonly nodeId: string;
      readonly runId: string;
      readonly epoch: number;
    };
    readonly candidateCommit: string;
    readonly canonicalHeadBefore: string;
    readonly progress: { readonly stage: string };
  };
}

function findNode(graph: GraphV2, id: string) {
  return graph.nodes.find((node) => node.id === id);
}

async function claimWorker(
  handle: TestClientHandle,
): Promise<{ readonly assignments: readonly AssignmentFenceWire[] }> {
  const current = await readGraph(handle);
  const result = await callToolJson<{ readonly assignments: readonly AssignmentFenceWire[] }>(
    handle,
    "ramune_claim_ready",
    {
      expected_revision: current.revision,
      limit: 1,
      base_commit: BASE_COMMIT,
    },
  );
  if (result.assignments.length === 0) {
    throw new Error("worker claim に失敗したフィクスチャ");
  }
  return result;
}

/** r1 を挿入し worker が候補を提出済み（awaiting_integration）にした状態を作る。 */
async function setUpAwaitingIntegration(handle: TestClientHandle): Promise<void> {
  await insertTask(handle, "r1");
  const claimedWorker = await claimWorker(handle);
  const [fence] = claimedWorker.assignments;
  if (!fence) {
    throw new Error("claim に失敗");
  }
  await callToolJson(handle, "ramune_submit_candidate", {
    fence: toWireFence(fence),
    commit: CANONICAL_BEFORE,
    report: { summary: "作業報告", data: null },
  });
}

/** claimed の journal を merge_prepared → publish_prepared まで進める。 */
async function advanceToPublishPrepared(
  handle: TestClientHandle,
  wireFence: ReturnType<typeof toWireFence>,
): Promise<GraphV2> {
  await callToolJson<GraphV2>(handle, "ramune_advance_integration", {
    fence: wireFence,
    progress: { stage: "merge_prepared", integrated_commit: INTEGRATED },
  });
  return await callToolJson<GraphV2>(handle, "ramune_advance_integration", {
    fence: wireFence,
    progress: {
      stage: "publish_prepared",
      integrated_commit: INTEGRATED,
      verification: {
        checked_commit: INTEGRATED,
        output_digest: DIGEST,
        finished_at: "2026-08-24T01:00:00Z",
      },
    },
  });
}

async function claimIntegrationNow(handle: TestClientHandle): Promise<IntegrationClaimWire> {
  const current = await readGraph(handle);
  return await callToolJson(handle, "ramune_claim_integration", {
    expected_revision: current.revision,
    canonical_head_before: CANONICAL_BEFORE,
  });
}

describe("ramune_claim_integration", () => {
  let handle: TestClientHandle;

  beforeEach(async () => {
    handle = await connectAndStart();
    await setUpAwaitingIntegration(handle);
  });

  afterEach(async () => {
    await handle.close();
  });

  it("awaiting_integration を integrating にし、journal（claimed）を書く", async () => {
    expect.hasAssertions();
    const claimed = await claimIntegrationNow(handle);

    expect(claimed.journal).toMatchObject({
      candidateCommit: CANONICAL_BEFORE,
      canonicalHeadBefore: CANONICAL_BEFORE,
      progress: { stage: "claimed" },
    });
    expect(claimed.journal.assignment.nodeId).toBe("r1");
    expect(findNode(claimed.graph, "r1")?.status).toBe("integrating");
  });
});

describe("ramune_advance_integration", () => {
  let handle: TestClientHandle;

  beforeEach(async () => {
    handle = await connectAndStart();
    await setUpAwaitingIntegration(handle);
  });

  afterEach(async () => {
    await handle.close();
  });

  it("journal を claimed → merge_prepared → publish_prepared と進められる", async () => {
    expect.hasAssertions();
    const claimed = await claimIntegrationNow(handle);
    const wireFence = toWireFence(claimed.journal.assignment);

    const prepared = await advanceToPublishPrepared(handle, wireFence);

    const r1 = findNode(prepared, "r1");
    if (r1?.kind !== "task" || r1.effect !== "repository_change" || r1.status !== "integrating") {
      throw new Error("r1 は integrating のはず");
    }
    expect(r1.integration.progress).toStrictEqual({
      stage: "publish_prepared",
      integratedCommit: INTEGRATED,
      verification: {
        command: "mise run check",
        exitCode: 0,
        checkedCommit: INTEGRATED,
        outputDigest: DIGEST,
        finishedAt: "2026-08-24T01:00:00Z",
      },
    });
  });
});

describe("ramune_advance_integration: 段階の強制", () => {
  let handle: TestClientHandle;

  beforeEach(async () => {
    handle = await connectAndStart();
    await setUpAwaitingIntegration(handle);
  });

  afterEach(async () => {
    await handle.close();
  });

  it("merge_prepared を経ずに publish_prepared へは進めない", async () => {
    expect.hasAssertions();
    const claimed = await claimIntegrationNow(handle);
    const message = await expectDomainRejection(handle, "ramune_advance_integration", {
      fence: toWireFence(claimed.journal.assignment),
      progress: {
        stage: "publish_prepared",
        integrated_commit: INTEGRATED,
        verification: {
          checked_commit: INTEGRATED,
          output_digest: DIGEST,
          finished_at: "2026-08-24T01:00:00Z",
        },
      },
    });
    expect(message).toContain("invalid_stage_order");
  });
});
