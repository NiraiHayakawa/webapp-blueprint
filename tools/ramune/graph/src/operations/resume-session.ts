// resume_session: サーバ / Orchestrator の死亡からのセッション再開
// （ramune_resume のグラフ層。§7）。epoch を +1 し、旧 epoch の live assignment を
// blocked(session_resumed) へ遷移させる。生き残った旧 agent の書き戻しは、以後の
// fence 不一致（stale fence）で拒否される。
//
// live assignment = running ノードの Worker assignment。awaiting_integration は
// candidate 保持のみで書き込み権を持たないため触らない。
//
// integrating のノードが 1 件でも存在する場合は拒否する（§7 / §8）。統合中の
// Integrator の死亡は、candidate と journal を保持したまま abandon_assignment の
// 照合（publish 済み → done / clean → awaiting / 不确定 → fail-closed）で状態を
// 確定させる手順があり、resume が journal を落としてしまうと照合の機会を破壊する。
// 破壊する経路を機械で塞ぐ。
import type { GraphV2 } from "../graph.ts";
import {
  blockageIdSchema,
  epochSchema,
  toNonEmptyString,
  type Epoch,
  type NonEmptyString,
  type Revision,
} from "../brand.ts";
import { allocateId, finalizeTransaction, nextRevision } from "../transaction.ts";
import { fenceOf } from "../assignment.ts";
import { EpochOverflowError } from "./epoch-overflow-error.ts";
import type { ExecutionBlockage } from "../blockage.ts";
import type { GraphNode, ReadOnlyNode, RepositoryNode } from "../nodes.ts";

export interface ResumeSessionOperation {
  readonly type: "resume_session";
}

export type ResumeSessionPreconditionViolation =
  | { readonly reason: "session_not_active" }
  | {
      /** 統合中のノードが残っている。先に abandon_assignment の照合で状態を確定させること（§7）。 */
      readonly reason: "integrating_node_exists";
      readonly nodeIds: readonly string[];
    };

export class ResumeSessionPreconditionError extends Error {
  readonly violation: ResumeSessionPreconditionViolation;

  constructor(violation: ResumeSessionPreconditionViolation) {
    super(`resume_session の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "ResumeSessionPreconditionError";
    this.violation = violation;
  }
}

type RunningReadOnlyNode = Extract<ReadOnlyNode, { readonly status: "running" }>;
type RunningRepositoryNode = Extract<RepositoryNode, { readonly status: "running" }>;
type BlockedReadOnlyNode = Extract<ReadOnlyNode, { readonly status: "blocked" }>;
type BlockedRepositoryNode = Extract<RepositoryNode, { readonly status: "blocked" }>;

const REASON: NonEmptyString = toNonEmptyString(
  "セッションが再開され、旧 epoch の assignment を失効させた",
);

function isRunningTask(node: GraphNode): node is RunningReadOnlyNode | RunningRepositoryNode {
  return node.kind === "task" && node.status === "running";
}

function blockedVariantOf(
  node: RunningReadOnlyNode | RunningRepositoryNode,
  blockage: ExecutionBlockage,
): BlockedReadOnlyNode | BlockedRepositoryNode {
  const base = {
    kind: "task" as const,
    id: node.id,
    title: node.title,
    deps: node.deps,
    resolutions: node.resolutions,
  };
  if (node.effect === "read_only") {
    return {
      ...base,
      purpose: "planned",
      effect: "read_only",
      status: "blocked",
      phase: "execution",
      blockage,
    };
  }
  const origin =
    node.purpose === "conflict_resolution"
      ? { purpose: node.purpose, resolves: node.resolves, conflict: node.conflict }
      : { purpose: node.purpose };
  return {
    ...base,
    ...origin,
    effect: "repository_change",
    status: "blocked",
    phase: "execution",
    blockage,
  };
}

function requireNoIntegratingNode(graph: GraphV2): void {
  const integrating = graph.nodes.filter(
    (node): node is Extract<RepositoryNode, { readonly status: "integrating" }> =>
      node.kind === "task" && node.effect === "repository_change" && node.status === "integrating",
  );
  if (integrating.length > 0) {
    throw new ResumeSessionPreconditionError({
      reason: "integrating_node_exists",
      nodeIds: integrating.map((node) => node.id),
    });
  }
}

function nextEpoch(session: Extract<GraphV2["session"], { readonly state: "active" }>): Epoch {
  const resumedToEpoch: Epoch = epochSchema.parse(session.epoch + 1);
  if (!Number.isSafeInteger(resumedToEpoch)) {
    throw new EpochOverflowError("epoch");
  }
  return resumedToEpoch;
}

interface BlockedLiveNodes {
  readonly graph: GraphV2;
  readonly nodes: readonly GraphNode[];
}

/** live assignment（running）を持つノードを blocked(session_resumed) へ確定させる。 */
function blockLiveNodes(graph: GraphV2, resumedToEpoch: Epoch): BlockedLiveNodes {
  const liveNodes = graph.nodes.filter(isRunningTask);
  let working = graph;
  const blockageIds = new Map<string, ExecutionBlockage["id"]>();
  for (const node of liveNodes) {
    const allocated = allocateId(working);
    working = allocated.graph;
    blockageIds.set(node.id, blockageIdSchema.parse(allocated.id));
  }
  const occurredAtRevision: Revision = nextRevision(graph);

  const nodes = graph.nodes.map((node): GraphNode => {
    if (!isRunningTask(node)) {
      return node;
    }
    const blockageId = blockageIds.get(node.id);
    if (blockageId === undefined) {
      // liveNodes（= isRunningTask で絞った集合）を先に全走査して発番しているため、
      // isRunningTask を満たす node は必ず blockageIds にエントリを持つ
      throw new TypeError(`blockage id が発番されていない: ${node.id}`);
    }
    const blockage: ExecutionBlockage = {
      id: blockageId,
      reason: REASON,
      occurredAtRevision,
      kind: "session_resumed",
      assignment: fenceOf(node.assignment),
      resumedToEpoch,
    };
    return blockedVariantOf(node, blockage);
  });

  return { graph: working, nodes };
}

export function resumeSession(graph: GraphV2, _op: ResumeSessionOperation): GraphV2 {
  if (graph.session.state !== "active") {
    throw new ResumeSessionPreconditionError({ reason: "session_not_active" });
  }
  requireNoIntegratingNode(graph);

  const { session } = graph;
  const resumedToEpoch = nextEpoch(session);
  const blocked = blockLiveNodes(graph, resumedToEpoch);

  return finalizeTransaction({
    ...blocked.graph,
    session: { state: "active", runId: session.runId, epoch: resumedToEpoch },
    nodes: blocked.nodes,
  });
}
