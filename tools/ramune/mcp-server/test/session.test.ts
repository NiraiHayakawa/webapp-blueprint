// ramune_start / ramune_end / ramune_resume の公開契約（§7 / §8）。
import { afterEach, describe, expect, it } from "vitest";
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import {
  callToolJson,
  connectTestClient,
  expectDomainRejection,
  parseGraphResponse,
  type TestClientHandle,
} from "./connect-test-client.ts";
import {
  claimReady,
  connectAndStart,
  GOAL,
  insertTask,
  readGraph,
  toWireFence,
  type AssignmentFenceWire,
  type AssignmentWire,
} from "./support.ts";

const CANONICAL_BEFORE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CANDIDATE_COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function findNode(graph: GraphV2, id: string) {
  return graph.nodes.find((node) => node.id === id);
}

/** 単一ノードを claim し、その 1 件の fence を返す（claim できなければテスト失敗）。 */
async function claimFirst(handle: TestClientHandle): Promise<AssignmentWire> {
  const claimed = await claimReady(handle);
  const [fence] = claimed.assignments;
  if (!fence) {
    throw new Error("claim に失敗");
  }
  return fence;
}

async function resumeWithCurrentRevision(handle: TestClientHandle): Promise<GraphV2> {
  const current = await readGraph(handle);
  return await callToolJson<GraphV2>(handle, "ramune_resume", {
    expected_revision: current.revision,
  });
}

async function resumeRejecting(handle: TestClientHandle): Promise<string> {
  const current = await readGraph(handle);
  return await expectDomainRejection(handle, "ramune_resume", {
    expected_revision: current.revision,
  });
}

async function submitCandidate(handle: TestClientHandle, fence: AssignmentWire): Promise<void> {
  await callToolJson(handle, "ramune_submit_candidate", {
    fence: toWireFence(fence),
    commit: CANDIDATE_COMMIT,
    report: { summary: "作業した", data: null },
  });
}

async function claimIntegrationFence(handle: TestClientHandle): Promise<AssignmentFenceWire> {
  const beforeIntegrating = await readGraph(handle);
  const integrationClaim = await callToolJson<{
    readonly journal: { readonly assignment: AssignmentFenceWire };
  }>(handle, "ramune_claim_integration", {
    expected_revision: beforeIntegrating.revision,
    canonical_head_before: CANONICAL_BEFORE,
  });
  return integrationClaim.journal.assignment;
}

/** 遷移先の blockage が session_resumed であることをグラフで確認する。 */
async function assertBlockedBySessionResumed(
  handle: TestClientHandle,
  nodeId: string,
): Promise<void> {
  const graph = await readGraph(handle);
  const node = findNode(graph, nodeId);
  if (
    node?.kind !== "task" ||
    node.effect !== "read_only" ||
    node.status !== "blocked" ||
    node.phase !== "execution"
  ) {
    throw new Error(`${nodeId} は実行段階 blocked のはず`);
  }
  expect(node.blockage.kind).toBe("session_resumed");
}

/** repo1 を worker が提出し、Integrator が claim して integrating にした状態を作る。 */
async function setUpIntegratingRepo1(handle: TestClientHandle): Promise<AssignmentFenceWire> {
  await insertTask(handle, "repo1");
  const workerFence = await claimFirst(handle);
  await submitCandidate(handle, workerFence);
  // integrating を作り、Integrator 自身の fence を入手する
  return await claimIntegrationFence(handle);
}

async function abandonIntegration(
  handle: TestClientHandle,
  fence: AssignmentFenceWire,
): Promise<GraphV2> {
  return await callToolJson<GraphV2>(handle, "ramune_abandon_assignment", {
    fence: toWireFence(fence),
    evidence: "プロセス終了を確認した",
    observed_git: {
      canonical_head: CANONICAL_BEFORE,
      canonical_worktree: "clean",
      integration_workspace: "dirty",
    },
  });
}

describe("ramune_start", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("グラフが無い状態で呼ぶと goal でグラフを作成し、稼働状態にする", async () => {
    handle = await connectTestClient();

    const graph = parseGraphResponse(
      await handle.client.callTool({ name: "ramune_start", arguments: { goal: GOAL } }),
    );

    expect(graph.version).toBe(2);
    expect(graph.goal).toBe(GOAL);
    expect(graph.session).toMatchObject({ state: "active", epoch: 0 });
    if (graph.session.state !== "active") {
      throw new Error("ramune_start 直後の session は active のはず");
    }
    // runId はサーバーが発番する（UUID 形式）
    expect(graph.session.runId).toMatch(/^[0-9a-f-]{36}$/u);
    const start = graph.nodes.find((node) => node.id === "start");
    expect(start?.status).toBe("done");
  });

  it("既に稼働中の場合は isError で拒否される（黙って上書きしない）", async () => {
    handle = await connectTestClient();
    await handle.client.callTool({ name: "ramune_start", arguments: { goal: GOAL } });

    const message = await expectDomainRejection(handle, "ramune_start", { goal: GOAL });

    expect(message).toContain("already_active");
  });

  it.each([
    { name: "goal を欠く", toolArguments: {} },
    { name: "goal が空文字列", toolArguments: { goal: "" } },
    { name: "余分なフィールド", toolArguments: { goal: "g", extra: true } },
  ] as const)("$name は JSON Schema 違反として拒否される", async ({ toolArguments }) => {
    handle = await connectTestClient();

    await expect(
      handle.client.callTool({ name: "ramune_start", arguments: toolArguments }),
    ).rejects.toThrow(/JSON Schema/u);
  });
});

describe("ramune_end", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("実行中ノードが無ければ非稼働にでき、end boundary が done になる", async () => {
    handle = await connectAndStart();

    const graph = await callToolJson<GraphV2>(handle, "ramune_end", {});

    expect(graph.session.state).toBe("inactive");
    const end = graph.nodes.find((node) => node.id === "end");
    // start は開始時に done 済みなので end の deps は揃っている
    expect(end?.status).toBe("done");
  });

  it("running ノードがある場合は unfinished_nodes_exist で拒否される", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "r1");
    await claimReady(handle);

    const message = await expectDomainRejection(handle, "ramune_end", {});

    expect(message).toContain("unfinished_nodes_exist");
  });

  it("非稼働で呼ぶと already_inactive で拒否される", async () => {
    handle = await connectAndStart();
    await callToolJson(handle, "ramune_end", {});

    const message = await expectDomainRejection(handle, "ramune_end", {});

    expect(message).toContain("already_inactive");
  });
});

describe("ramune_resume: epoch の前進", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("epoch を +1 し、旧 epoch の running assignment を blocked(session_resumed) にする", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "r1");
    const fence = await claimFirst(handle);

    const resumed = await resumeWithCurrentRevision(handle);

    if (resumed.session.state !== "active") {
      throw new Error("resume 後は稼働中のはず");
    }
    expect(resumed.session).toStrictEqual({
      state: "active",
      runId: fence.runId,
      epoch: 1,
    });
    const r1 = findNode(resumed, "r1");
    expect(r1?.status).toBe("blocked");
  });
});

describe("ramune_resume: 旧 epoch の Worker 報告", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("resume 後、旧 epoch の Worker が完了報告してもノードは既に blocked であり受理されない", async () => {
    handle = await connectAndStart();
    await insertTask(handle, "ro1", { effect: "read_only" });
    const fence = await claimFirst(handle);
    await resumeWithCurrentRevision(handle);

    const message = await expectDomainRejection(handle, "ramune_record_result", {
      fence: toWireFence(fence),
      report: { summary: "報告", data: null },
    });

    // resume が先に該当ノードを blocked(session_resumed) へ遷移させるため、
    // 旧 assignment による書き込みは状態前提条件の段階で拒まれる
    expect(message).toContain('"reason":"not_running"');
    await assertBlockedBySessionResumed(handle, "ro1");
  });
});

describe("ramune_resume: integrating ノードの照合", () => {
  let handle: TestClientHandle;

  afterEach(async () => {
    await handle.close();
  });

  it("integrating ノードが存在するときは拒否され、abandon 照合で解消すれば resume できる", async () => {
    handle = await connectAndStart();
    const integratorFence = await setUpIntegratingRepo1(handle);

    const rejectionMessage = await resumeRejecting(handle);

    // 照合（abandon）で awaiting_integration へ戻す。fence は Integrator 自身のもの
    const reconciled = await abandonIntegration(handle, integratorFence);
    expect(findNode(reconciled, "repo1")?.status).toBe("awaiting_integration");

    const resumed = await resumeWithCurrentRevision(handle);
    if (resumed.session.state !== "active") {
      throw new Error("resume 後は稼働中のはず");
    }
    expect(resumed.session.epoch).toBe(1);
    // 拒否メッセージが契約どおりの理由を名指ししていること
    expect(rejectionMessage).toContain("integrating_node_exists");
  });
});
