// claim_ready: ready ノードの選択と pending → running 遷移を同一 transaction で行う
// （設計正本 §3。ramune_next_node を置き換える）。選択は selectReadyNodes のとおり
// 宣言順で決定的に行い、limit 件を先頭から取る。
//
// 各 claim に対して allocator から assignmentId を発番し、fence
// （{ nodeId, runId, epoch, assignmentId }）を書き込む。runId / epoch は現在の
// session からコピーする。repository_change ノードには隔離 worktree の割当
// （workspaceId / baseCommit）が要るため、呼び出し側（サーバ）が workspaces で
// 渡したプールを宣言順に消費する。worktree が必要なノードまで来たときにプールが
// 空なら、そこで選択を打ち切る（宣言順の連続した prefix だけを claim する）。
// 余ったプールは黙って捨てず、前提条件違反として拒否する。
import type { GraphV2 } from "../graph.ts";
import { assignmentIdSchema, type CommitId, type IsoDateTime, type WorkspaceId } from "../brand.ts";
import { allocateId, finalizeTransaction } from "../transaction.ts";
import { selectReadyNodes, InvalidReadyLimitError } from "../ready.ts";
import type { WorkerAssignment } from "../assignment.ts";
import type { GraphNode } from "../nodes.ts";

export interface WorkspaceAllocation {
  readonly workspaceId: WorkspaceId;
  readonly baseCommit: CommitId;
}

export interface ClaimReadyOperation {
  readonly type: "claim_ready";
  /** claim の上限。1 以上の safe integer。 */
  readonly limit: number;
  /** assignment.startedAt として記録する時刻（診断情報。状態遷移には使わない）。 */
  readonly startedAt: IsoDateTime;
  /**
   * repository_change ノードへ割り当てる隔離 worktree のプール（宣言順に消費）。
   * read_only ノードには使われない。
   */
  readonly workspaces?: readonly WorkspaceAllocation[];
}

export interface ClaimReadyResult {
  readonly graph: GraphV2;
  readonly assignments: readonly WorkerAssignment[];
}

export type ClaimReadyPreconditionViolation =
  | { readonly reason: "session_not_active" }
  | { readonly reason: "invalid_limit"; readonly limit: number }
  | { readonly reason: "workspace_surplus"; readonly unconsumed: readonly WorkspaceAllocation[] };

export class ClaimReadyPreconditionError extends Error {
  readonly violation: ClaimReadyPreconditionViolation;

  constructor(violation: ClaimReadyPreconditionViolation) {
    super(`claim_ready の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "ClaimReadyPreconditionError";
    this.violation = violation;
  }
}

type PendingTaskNode = Extract<GraphNode, { readonly kind: "task"; readonly status: "pending" }>;
type RunningTaskNode = Extract<GraphNode, { readonly kind: "task"; readonly status: "running" }>;

type ActiveSession = Extract<GraphV2["session"], { readonly state: "active" }>;

/** assignment を組み立てる共通入力（read_only / repository_change 双方の builder で共有）。 */
interface AssignmentInput {
  readonly nodeId: PendingTaskNode["id"];
  readonly session: ActiveSession;
  readonly id: ReturnType<typeof assignmentIdSchema.parse>;
  readonly startedAt: IsoDateTime;
}

function readOnlyAssignment(input: AssignmentInput): WorkerAssignment {
  return {
    role: "worker",
    effect: "read_only",
    id: input.id,
    nodeId: input.nodeId,
    runId: input.session.runId,
    epoch: input.session.epoch,
    startedAt: input.startedAt,
  };
}

function repositoryAssignment(
  input: AssignmentInput & { readonly workspace: WorkspaceAllocation },
): WorkerAssignment {
  return {
    role: "worker",
    effect: "repository_change",
    id: input.id,
    nodeId: input.nodeId,
    runId: input.session.runId,
    epoch: input.session.epoch,
    workspaceId: input.workspace.workspaceId,
    baseCommit: input.workspace.baseCommit,
    startedAt: input.startedAt,
  };
}

interface ClaimContext {
  readonly session: ActiveSession;
  readonly startedAt: IsoDateTime;
}

interface OneClaimResult {
  readonly working: GraphV2;
  readonly assignment: WorkerAssignment;
}

function claimReadOnlyNode(
  graph: GraphV2,
  node: PendingTaskNode,
  ctx: ClaimContext,
): OneClaimResult {
  const claimed = allocateId(graph);
  const assignment = readOnlyAssignment({
    nodeId: node.id,
    session: ctx.session,
    id: assignmentIdSchema.parse(claimed.id),
    startedAt: ctx.startedAt,
  });
  return { working: claimed.graph, assignment };
}

function claimRepositoryNode(
  graph: GraphV2,
  node: PendingTaskNode,
  ctx: ClaimContext & { readonly workspace: WorkspaceAllocation },
): OneClaimResult {
  const claimed = allocateId(graph);
  const assignment = repositoryAssignment({
    nodeId: node.id,
    session: ctx.session,
    id: assignmentIdSchema.parse(claimed.id),
    startedAt: ctx.startedAt,
    workspace: ctx.workspace,
  });
  return { working: claimed.graph, assignment };
}

type ClaimStep =
  | ({ readonly outcome: "claimed" } & OneClaimResult)
  | { readonly outcome: "pool_exhausted" };

/** candidates 1 件分の claim（fence 発番込み）。プールが尽きたら pool_exhausted を返す。 */
function claimOneCandidate(
  graph: GraphV2,
  node: PendingTaskNode,
  context: ClaimContext & {
    /** 宣言順に消費し、残りを呼び出し側へ返すための可変プール。 */
    readonly pool: WorkspaceAllocation[];
  },
): ClaimStep {
  if (node.effect === "read_only") {
    return { outcome: "claimed", ...claimReadOnlyNode(graph, node, context) };
  }
  const workspace = context.pool.shift();
  if (!workspace) {
    return { outcome: "pool_exhausted" };
  }
  return { outcome: "claimed", ...claimRepositoryNode(graph, node, { ...context, workspace }) };
}

/**
 * candidates を宣言順に claim する（fence 発番込み）。repository_change ノードは
 * プールを宣言順に消費し、尽きた時点で打ち切る（連続 prefix のみ claim する）。
 */
function claimCandidates(
  graph: GraphV2,
  candidates: readonly PendingTaskNode[],
  context: ClaimContext & {
    /** 宣言順に消費し、残りを呼び出し側へ返すための可変プール。 */
    readonly pool: WorkspaceAllocation[];
  },
) {
  let working = graph;
  const assignments: WorkerAssignment[] = [];
  for (const node of candidates) {
    const step = claimOneCandidate(working, node, context);
    if (step.outcome === "pool_exhausted") {
      break;
    }
    ({ working } = step);
    assignments.push(step.assignment);
  }
  return { working, assignments };
}

function isPendingTask(node: GraphNode): node is PendingTaskNode {
  return node.kind === "task" && node.status === "pending";
}

function runningVariantOf(node: PendingTaskNode, assignment: WorkerAssignment): RunningTaskNode {
  const common = {
    kind: "task" as const,
    id: node.id,
    title: node.title,
    deps: node.deps,
    resolutions: node.resolutions,
  };
  if (node.effect === "read_only") {
    if (assignment.effect !== "read_only") {
      throw new Error(
        "read_only ノードに repository_change の assignment を割り当てた（実装バグ）",
      );
    }
    return {
      ...common,
      purpose: "planned",
      effect: "read_only",
      status: "running",
      assignment,
    };
  }
  if (assignment.effect !== "repository_change") {
    throw new Error("repository_change ノードに read_only の assignment を割り当てた（実装バグ）");
  }
  const origin =
    node.purpose === "conflict_resolution"
      ? { purpose: node.purpose, resolves: node.resolves, conflict: node.conflict }
      : { purpose: node.purpose };
  return {
    ...common,
    ...origin,
    effect: "repository_change",
    status: "running",
    assignment,
  };
}

function selectCandidatesOrThrow(graph: GraphV2, limit: number): readonly PendingTaskNode[] {
  try {
    return selectReadyNodes(graph, limit);
  } catch (error) {
    if (error instanceof InvalidReadyLimitError) {
      throw new ClaimReadyPreconditionError({ reason: "invalid_limit", limit });
    }
    throw error;
  }
}

function applyAssignments(
  nodes: readonly GraphNode[],
  assignments: readonly WorkerAssignment[],
): readonly GraphNode[] {
  return nodes.map((node) => {
    if (!isPendingTask(node)) {
      return node;
    }
    const assignment = assignments.find((candidate) => candidate.nodeId === node.id);
    if (!assignment) {
      return node;
    }
    return runningVariantOf(node, assignment);
  });
}

export function claimReady(graph: GraphV2, op: ClaimReadyOperation): ClaimReadyResult {
  if (graph.session.state !== "active") {
    throw new ClaimReadyPreconditionError({ reason: "session_not_active" });
  }
  const candidates = selectCandidatesOrThrow(graph, op.limit);

  const { session } = graph;
  const pool = [...(op.workspaces ?? [])];
  const { working, assignments } = claimCandidates(graph, candidates, {
    session,
    startedAt: op.startedAt,
    pool,
  });

  if (pool.length > 0) {
    throw new ClaimReadyPreconditionError({ reason: "workspace_surplus", unconsumed: [...pool] });
  }

  const nodes = applyAssignments(graph.nodes, assignments);
  return { graph: finalizeTransaction({ ...working, nodes }), assignments };
}
