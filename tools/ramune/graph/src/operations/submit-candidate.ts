// submit_candidate: repository_change ノードを running → awaiting_integration にする
// （ramune_submit_candidate のグラフ層。§6.1）。Worker は自分の worktree で作った
// candidate commit を提出し、これをもって Worker の仕事は終わる（ノードはまだ
// done ではない）。
//
// candidate.source は Worker の申告ではなく、サーバが current assignment から
// コピーする（Worker は baseCommit / workspaceId を入力として受け取らない）。
// そのためこの操作の入力には fence だけを取り、source はノードに書き込まれた
// assignment から構築される。fence の完全一致を要求する（§3）。
import type { GraphV2 } from "../graph.ts";
import type { CommitId, IsoDateTime } from "../brand.ts";
import { finalizeTransaction } from "../transaction.ts";
import { sameFence, type AssignmentFence } from "../assignment.ts";
import type { Candidate, WorkReport } from "../work.ts";
import type { GraphNode, RepositoryNode } from "../nodes.ts";

export interface SubmitCandidateOperation {
  readonly type: "submit_candidate";
  readonly nodeId: string;
  readonly fence: AssignmentFence;
  /** Worker が自分の隔離 worktree で作った candidate commit。 */
  readonly commit: CommitId;
  readonly report: WorkReport;
  readonly submittedAt: IsoDateTime;
}

export type SubmitCandidatePreconditionViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | { readonly reason: "not_repository_node"; readonly nodeId: string }
  | { readonly reason: "not_running"; readonly nodeId: string; readonly status: string }
  | {
      readonly reason: "stale_fence";
      readonly nodeId: string;
      readonly presentedFence: AssignmentFence;
    };

export class SubmitCandidatePreconditionError extends Error {
  readonly violation: SubmitCandidatePreconditionViolation;

  constructor(violation: SubmitCandidatePreconditionViolation) {
    super(`submit_candidate の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "SubmitCandidatePreconditionError";
    this.violation = violation;
  }
}

function throwSubmitCandidatePreconditionError(
  violation: SubmitCandidatePreconditionViolation,
): never {
  throw new SubmitCandidatePreconditionError(violation);
}

type RunningRepositoryNode = Extract<RepositoryNode, { readonly status: "running" }>;

function isRunningRepository(node: GraphNode): node is RunningRepositoryNode {
  return node.kind === "task" && node.effect === "repository_change" && node.status === "running";
}

// similarity-ignore: 各操作の finder は fail-fast の前提条件イディオムとして意図的に
// 並行構造を持つ。narrowing 先の型と precondition エラーの reason union が操作ごとの
// 公開契約であり、ジェネリクスで統合すると契約の判読性を失う（設計判断。wp8.md 参照）。
function findSubmittableTarget(
  graph: GraphV2,
  op: SubmitCandidateOperation,
): RunningRepositoryNode {
  const target = graph.nodes.find((node) => node.id === op.nodeId);
  if (!target) {
    return throwSubmitCandidatePreconditionError({ reason: "node_not_found", nodeId: op.nodeId });
  }
  if (target.kind !== "task" || target.effect !== "repository_change") {
    return throwSubmitCandidatePreconditionError({
      reason: "not_repository_node",
      nodeId: op.nodeId,
    });
  }
  if (target.status !== "running") {
    return throwSubmitCandidatePreconditionError({
      reason: "not_running",
      nodeId: op.nodeId,
      status: target.status,
    });
  }
  if (!sameFence(target.assignment, op.fence)) {
    return throwSubmitCandidatePreconditionError({
      reason: "stale_fence",
      nodeId: op.nodeId,
      presentedFence: op.fence,
    });
  }
  return target;
}

function toAwaitingNode(node: RunningRepositoryNode, candidate: Candidate): GraphNode {
  const origin =
    node.purpose === "conflict_resolution"
      ? { purpose: node.purpose, resolves: node.resolves, conflict: node.conflict }
      : { purpose: node.purpose };
  return {
    kind: "task",
    id: node.id,
    title: node.title,
    deps: node.deps,
    resolutions: node.resolutions,
    ...origin,
    effect: "repository_change",
    status: "awaiting_integration",
    candidate,
  };
}

export function submitCandidate(graph: GraphV2, op: SubmitCandidateOperation): GraphV2 {
  const target = findSubmittableTarget(graph, op);
  const candidate: Candidate = {
    commit: op.commit,
    source: target.assignment,
    report: op.report,
    submittedAt: op.submittedAt,
  };

  const nodes = graph.nodes.map((node): GraphNode => {
    if (!isRunningRepository(node) || node.id !== op.nodeId) {
      return node;
    }
    return toAwaitingNode(node, candidate);
  });

  return finalizeTransaction({ ...graph, nodes });
}
