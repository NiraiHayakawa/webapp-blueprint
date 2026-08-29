// ツールテスト共通のヘルパ。公開契約（MCP クライアント経由の呼び出し）だけを
// 扱い、内部実装には触れない。
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import { callToolJson, connectTestClient, type TestClientHandle } from "./connect-test-client.ts";

export const GOAL = "テスト用ゴール";
const COMMIT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** 接続して ramune_start まで済ませたクライアント。 */
export async function connectAndStart(): Promise<TestClientHandle> {
  const handle = await connectTestClient();
  await callToolJson(handle, "ramune_start", { goal: GOAL });
  return handle;
}

export async function readGraph(handle: TestClientHandle): Promise<GraphV2> {
  return await callToolJson<GraphV2>(handle, "ramune_read_graph");
}

/**
 * task ノードを挿入する（start と end の間。既定は repository_change）。
 * 現行の操作セットでは挿入は常に既存エッジの分割であるため、グラフは鎖状に
 * 成長する。
 */
export async function insertTask(
  handle: TestClientHandle,
  id: string,
  options: {
    readonly effect?: "read_only" | "repository_change";
    readonly from?: string;
    readonly to?: string;
  } = {},
): Promise<GraphV2> {
  const current = await readGraph(handle);
  return await callToolJson<GraphV2>(handle, "ramune_apply_ops", {
    expected_revision: current.revision,
    operations: [
      {
        type: "insert_node",
        from: options.from ?? "start",
        to: options.to ?? "end",
        newNode: { id, title: id, effect: options.effect ?? "repository_change" },
      },
    ],
  });
}

/**
 * fence だけを運ぶワイヤ形式（claim_ready / claim_integration いずれの
 * assignment にも共通する最小形）。role や effect 等の追加情報が要らない
 * テストはこの形をそのまま使う。
 */
export interface AssignmentFenceWire {
  readonly id: number;
  readonly nodeId: string;
  readonly runId: string;
  readonly epoch: number;
}

/** claim_ready の応答（fence 配列）。nodeId / runId / epoch をワイヤ名のまま運ぶ。 */
export interface AssignmentWire extends AssignmentFenceWire {
  readonly role: "worker";
  readonly effect: "read_only" | "repository_change";
  readonly workspaceId?: string;
  readonly baseCommit?: string;
  readonly startedAt: string;
}

export async function claimReady(
  handle: TestClientHandle,
  baseCommit = COMMIT_A,
  limit = 1,
): Promise<{ readonly graph: GraphV2; readonly assignments: readonly AssignmentWire[] }> {
  const current = await readGraph(handle);
  return await callToolJson(handle, "ramune_claim_ready", {
    expected_revision: current.revision,
    limit,
    base_commit: baseCommit,
  });
}

/** ドメインの fence（camelCase）をツール入力のワイヤ形式へ変換する。 */
export function toWireFence(assignment: AssignmentFenceWire) {
  return {
    id: assignment.id,
    node_id: assignment.nodeId,
    run_id: assignment.runId,
    epoch: assignment.epoch,
  };
}

export function findNode(graph: GraphV2, id: string) {
  return graph.nodes.find((node) => node.id === id);
}

export const CANONICAL_BEFORE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const CANDIDATE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const INTEGRATED = "cccccccccccccccccccccccccccccccccccccccc";

/** repo task を candidate 提出まで進め、worker fence を返す。 */
export async function prepareCandidate(
  handle: TestClientHandle,
  nodeId: string,
): Promise<AssignmentWire> {
  await insertTask(handle, nodeId);
  const beforeClaim = await readGraph(handle);
  const claimed = await callToolJson<{ readonly assignments: readonly AssignmentWire[] }>(
    handle,
    "ramune_claim_ready",
    {
      expected_revision: beforeClaim.revision,
      limit: 1,
      base_commit: CANONICAL_BEFORE,
    },
  );
  const [fence] = claimed.assignments;
  if (!fence) {
    throw new Error("claim に失敗");
  }
  await callToolJson(handle, "ramune_submit_candidate", {
    fence: toWireFence(fence),
    commit: CANDIDATE,
    report: { summary: "作業報告", data: null },
  });
  return fence;
}

export async function integrateUntilPublishPrepared(
  handle: TestClientHandle,
): Promise<ReturnType<typeof toWireFence>> {
  const before = await readGraph(handle);
  const claimedIntegration = await callToolJson<{
    readonly journal: { readonly assignment: AssignmentWire };
  }>(handle, "ramune_claim_integration", {
    expected_revision: before.revision,
    canonical_head_before: CANONICAL_BEFORE,
  });
  const wireFence = toWireFence(claimedIntegration.journal.assignment);

  await callToolJson(handle, "ramune_advance_integration", {
    fence: wireFence,
    progress: { stage: "merge_prepared", integrated_commit: INTEGRATED },
  });
  await callToolJson(handle, "ramune_advance_integration", {
    fence: wireFence,
    progress: {
      stage: "publish_prepared",
      integrated_commit: INTEGRATED,
      verification: {
        checked_commit: INTEGRATED,
        output_digest: "digest-1",
        finished_at: "2026-08-24T01:00:00Z",
      },
    },
  });
  return wireFence;
}
