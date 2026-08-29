// git-conflict-integration.test.ts が使う、§6.3 conflict 経路の harness:
// conflict の検出（実 merge を試みて MergeConflictError を観測する）・cleanup 証跡を
// 揃えた記録・機械挿入された解消ノード R の検証。git-integration-support.ts から
// 分離しているのは、conflict 経路固有のロジックであることと、1 ファイルの行数を
// 抑えるため（docs/principles 参照）。
import {
  commitIdSchema,
  findNode,
  workspaceIdSchema,
  type GraphNode,
  type GraphV2,
} from "@webapp-blueprint/ramune-graph";
import {
  allocateWorkspace,
  captureCanonicalAfterCleanup,
  cleanupFailedIntegration,
  MergeConflictError,
  prepareIntegrationMerge,
} from "@webapp-blueprint/ramune-git";
import { expect } from "vitest";

import { callToolJson, type TestClientHandle } from "./connect-test-client.ts";
import { readGraph, toWireFence } from "./support.ts";
import { requireNode, type ClaimIntegrationWire } from "./git-integration-support.ts";

export interface ConflictDetection {
  readonly conflicted: GraphV2;
  readonly conflictedFiles: readonly string[];
}

export interface BlockedConflictInfo {
  readonly resolverId: string;
  readonly candidateCommit: string;
}

/**
 * §6.3: 統合対象を claim して merge し、実際に conflict になったことを観測する。
 * conflict でなければテストの前提が崩れているため、その場で失敗させる。
 */
async function mergeAndCaptureConflict(input: {
  readonly integrationWorktreePath: string;
  readonly candidateCommit: string;
}): Promise<MergeConflictError> {
  try {
    await prepareIntegrationMerge({
      integrationWorktreePath: input.integrationWorktreePath,
      candidateCommit: commitIdSchema.parse(input.candidateCommit),
    });
  } catch (error) {
    if (error instanceof MergeConflictError) {
      return error;
    }
    throw error;
  }
  throw new Error("両側変更なのに conflict にならなかった");
}

/** conflict 発生後の cleanup を行い、canonical が衝突時点の HEAD へ clean に戻ったことを確かめる。 */
async function cleanupAndCaptureCanonical(input: {
  readonly repositoryRoot: string;
  readonly integrationWorktreePath: string;
  readonly canonicalHead: string;
}): Promise<string> {
  // Integrator は cleanup を済ませてから conflict を記録する。証跡は canonical が
  // clean に戻ったことまで含めて検査される。
  await cleanupFailedIntegration({ integrationWorktreePath: input.integrationWorktreePath });
  const evidence = await captureCanonicalAfterCleanup({ repositoryRoot: input.repositoryRoot });
  if (evidence.head !== input.canonicalHead) {
    throw new Error("cleanup 後の canonical HEAD が衝突時点と一致しない");
  }
  return evidence.head;
}

/**
 * §6.3: 統合対象を claim して merge し、実際に conflict になったことを観測してから
 * cleanup 証跡を揃えて conflict を記録する。
 */
export async function detectAndRecordConflict(
  handle: TestClientHandle,
  repositoryRoot: string,
  input: { readonly candidateCommit: string; readonly canonicalHead: string },
): Promise<ConflictDetection> {
  const beforeClaim = await readGraph(handle);
  const claimed = await callToolJson<ClaimIntegrationWire>(handle, "ramune_claim_integration", {
    expected_revision: beforeClaim.revision,
    canonical_head_before: input.canonicalHead,
  });
  const integrationWorkspace = await allocateWorkspace({
    repositoryRoot,
    workspaceId: workspaceIdSchema.parse("integration-c2"),
    baseCommit: commitIdSchema.parse(input.canonicalHead),
  });

  const conflict = await mergeAndCaptureConflict({
    integrationWorktreePath: integrationWorkspace.path,
    candidateCommit: input.candidateCommit,
  });
  const cleanedHead = await cleanupAndCaptureCanonical({
    repositoryRoot,
    integrationWorktreePath: integrationWorkspace.path,
    canonicalHead: input.canonicalHead,
  });

  const conflicted = await callToolJson<GraphV2>(handle, "ramune_record_integration_outcome", {
    fence: toWireFence(claimed.journal.assignment),
    outcome: {
      kind: "conflict",
      reason: "README.md の両側変更",
      title: "c2 の衝突を解消する",
      files: [...conflict.conflictedFiles],
      canonical_head_at_conflict: input.canonicalHead,
      canonical_after_cleanup: { head: cleanedHead },
    },
  });
  return { conflicted, conflictedFiles: conflict.conflictedFiles };
}

/** blocked(integration_conflict) へ遷移した repository_change ノードの判別。 */
type IntegrationConflictBlockedNode = Extract<
  GraphNode,
  {
    kind: "task";
    effect: "repository_change";
    status: "blocked";
    phase: "integration";
  }
>;

function isIntegrationConflictBlocked(node: GraphNode): node is IntegrationConflictBlockedNode & {
  readonly blockage: Extract<
    IntegrationConflictBlockedNode["blockage"],
    { kind: "integration_conflict" }
  >;
} {
  return (
    node.kind === "task" &&
    node.effect === "repository_change" &&
    node.status === "blocked" &&
    node.phase === "integration" &&
    node.blockage.kind === "integration_conflict"
  );
}

/** 機械挿入された R が pending の conflict_resolution task であることを見る。 */
function assertResolverInserted(graph: GraphV2, resolverId: string, resolvedNodeId: string): void {
  const resolver = findNode(graph, resolverId);
  if (resolver?.kind !== "task") {
    throw new Error("解消ノード R は pending の task として挿入されるべき");
  }
  expect(resolver.status).toBe("pending");
  expect(resolver.purpose).toBe("conflict_resolution");
  if (resolver.purpose !== "conflict_resolution") {
    throw new Error("解消ノード R の purpose は conflict_resolution であるべき");
  }
  expect(resolver.resolves).toBe(resolvedNodeId);
}

/** C 側が blocked(integration_conflict) になり、R が正しい形で機械挿入されたことを見る。 */
export function expectBlockedOnIntegrationConflict(
  graph: GraphV2,
  nodeId: string,
): BlockedConflictInfo {
  const node = requireNode(graph, nodeId);
  if (!isIntegrationConflictBlocked(node)) {
    throw new Error(`${nodeId} は blocked(integration_conflict) であるべき`);
  }
  const resolverId = node.blockage.resolutionNodeId;
  if (!node.deps.includes(resolverId)) {
    throw new Error("解消ノードの ID が C の deps に追加されていない");
  }
  assertResolverInserted(graph, resolverId, nodeId);
  return { resolverId, candidateCommit: node.candidate.commit };
}
