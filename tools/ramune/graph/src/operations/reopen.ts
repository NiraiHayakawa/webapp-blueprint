// reopen: blocked のノードを pending に戻す。そのノードの結果に依存していた後続ノード
// （done のもの限定。deps を辿って推移的に）も連動して pending に戻る。
//
// v2 での変更（ADR 0007 + 設計正本 §2.6）:
//   - 対象は blocked に限定される。done を直接 pending に戻す経路は持たない
//     （完了済み作業のやり直しは、Planner が新しいノードを挿入するか abort して
//     構造で表現する）
//   - resolution 文字列が必須。「外から来た答え」を ResolutionRecord
//     （直前の blockage のスナップショット付き）として resolutions へ追記する。
//     追記はこの遷移の transaction だけが行える
//   - integration_conflict / integration_state_uncertain の reopen は禁止。
//     前者は解消ノード R の統合成功で解消され、後者は §7 の照合で先に状態を
//     確定させなければならないためである
//   - verification_failed の reopen は、「observedGit が canonical clean を示している
//     こと」を前提条件とする（§2.6）。失敗した変更を含む canonical の上で次の統合が
//     始まることを防ぐ
//
// カスケード対象を「done のもの限定」にしている理由は v1 と同じ: 後続が aborted なら
// 蘇らせる根拠がなく、blocked の後続は自分自身の reopen を必要とするからである。
import type { GraphV2 } from "../graph.ts";
import { revisionSchema, type NonEmptyString, type Revision } from "../brand.ts";
import { finalizeTransaction } from "../transaction.ts";
import { requireTaskNode } from "./task-node.ts";
import type { GitObservation } from "../integration.ts";
import type {
  BlockedSnapshot,
  ExecutionBlockage,
  IntegrationBlockage,
  RepositoryOrigin,
  ResolutionRecord,
} from "../blockage.ts";
import type { GraphNode, ReadOnlyNode, RepositoryNode } from "../nodes.ts";

export interface ReopenOperation {
  readonly type: "reopen";
  readonly nodeId: string;
  /** 外から来た答え。Worker への再指示としてグラフに永続化される（ADR 0007）。 */
  readonly resolution: NonEmptyString;
  /**
   * blockage が verification_failed の場合のみ必須。canonical が clean に戻ったことの
   * 新しい観測。それ以外の kind で渡すことはできない（余計な入力は黙って捨てない）。
   */
  readonly observedGit?: GitObservation;
}

export type ReopenPreconditionViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | { readonly reason: "not_a_task_node"; readonly nodeId: string }
  | { readonly reason: "not_blocked"; readonly nodeId: string; readonly status: string }
  | {
      readonly reason: "reopen_forbidden";
      readonly nodeId: string;
      readonly kind: "integration_conflict" | "integration_state_uncertain";
    }
  | { readonly reason: "canonical_clean_required"; readonly nodeId: string }
  | { readonly reason: "observed_git_not_clean"; readonly nodeId: string }
  | { readonly reason: "unnecessary_observed_git"; readonly nodeId: string };

export class ReopenPreconditionError extends Error {
  readonly violation: ReopenPreconditionViolation;

  constructor(violation: ReopenPreconditionViolation) {
    super(`reopen の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "ReopenPreconditionError";
    this.violation = violation;
  }
}

/** reopen 可能な状態のノード（blocked のみ）。phase ごとに blockage の型が決まっている。 */
type ReopenableNode =
  | Extract<ReadOnlyNode, { readonly status: "blocked" }>
  | Extract<RepositoryNode, { readonly status: "blocked" }>;

type PendingReadOnly = Extract<ReadOnlyNode, { readonly status: "pending" }>;
type PendingRepository = Extract<RepositoryNode, { readonly status: "pending" }>;
type DoneTaskNode =
  | Extract<ReadOnlyNode, { readonly status: "done" }>
  | Extract<RepositoryNode, { readonly status: "done" }>;

/** snapshotOf の戻り値の名前付き契約（no-known-value-widening: 匿名オブジェクト型を避ける）。 */
interface ReopenSnapshotView {
  readonly snapshot: BlockedSnapshot;
  readonly forbiddenKind?: "integration_conflict" | "integration_state_uncertain" | undefined;
  readonly isVerificationFailed: boolean;
}

function snapshotOf(node: ReopenableNode): ReopenSnapshotView {
  if (node.phase === "execution") {
    const blockage: ExecutionBlockage = node.blockage;
    return { snapshot: { phase: "execution", blockage }, isVerificationFailed: false };
  }
  const blockage: IntegrationBlockage = node.blockage;
  return {
    snapshot: { phase: "integration", candidate: node.candidate, blockage },
    forbiddenKind:
      blockage.kind === "integration_conflict" || blockage.kind === "integration_state_uncertain"
        ? blockage.kind
        : undefined,
    isVerificationFailed: blockage.kind === "verification_failed",
  };
}

/**
 * task ノードを pending 形へ組み替える。resolutions は呼び出し側が渡す
 * （target への record 追記と、カスケード対象の履歴保持を1つの実装で共有する）。
 */
function pendingVariantOf(
  node: ReopenableNode | DoneTaskNode,
  resolutions: readonly ResolutionRecord[],
): PendingReadOnly | PendingRepository {
  const common = {
    kind: "task" as const,
    id: node.id,
    title: node.title,
    deps: node.deps,
    resolutions,
  };
  if (node.effect === "read_only") {
    return { ...common, purpose: "planned", effect: "read_only", status: "pending" };
  }
  const origin: RepositoryOrigin =
    node.purpose === "conflict_resolution"
      ? { purpose: "conflict_resolution", resolves: node.resolves, conflict: node.conflict }
      : { purpose: "planned" };
  return { ...common, ...origin, effect: "repository_change", status: "pending" };
}

interface ForwardAdjacency {
  readonly dependentsOf: (nodeId: string) => readonly string[];
}

function buildForwardAdjacency(graph: GraphV2): ForwardAdjacency {
  const forward = new Map<string, string[]>();
  for (const node of graph.nodes) {
    for (const depId of node.deps) {
      const dependents = forward.get(depId) ?? [];
      dependents.push(node.id);
      forward.set(depId, dependents);
    }
  }
  return { dependentsOf: (nodeId) => forward.get(nodeId) ?? [] };
}

interface CascadeState {
  readonly collected: Set<string>;
  readonly queue: string[];
}

function enqueueDoneDependent(graph: GraphV2, dependentId: string, state: CascadeState): void {
  const dependent = graph.nodes.find((node) => node.id === dependentId);
  if (
    dependent?.kind !== "task" ||
    dependent.status !== "done" ||
    state.collected.has(dependentId)
  ) {
    return;
  }
  state.collected.add(dependentId);
  state.queue.push(dependentId);
}

/** done の依存先を辿って推移的に集める（BFS）。自分自身を含む。 */
function collectDoneDependentsTransitively(graph: GraphV2, rootId: string): ReadonlySet<string> {
  const adjacency = buildForwardAdjacency(graph);
  const state: CascadeState = { collected: new Set<string>([rootId]), queue: [rootId] };
  for (const current of state.queue) {
    for (const dependentId of adjacency.dependentsOf(current)) {
      enqueueDoneDependent(graph, dependentId, state);
    }
  }
  return state.collected;
}

type Fail = (violation: ReopenPreconditionViolation) => never;

function assertTaskTarget(graph: GraphV2, op: ReopenOperation, fail: Fail): ReopenableNode {
  const task = requireTaskNode(graph, op.nodeId, fail);
  if (task.status !== "blocked") {
    // 実行中系 / done / aborted への reopen は「何をやり直しているのか」が不明な
    // 状態遷移であり fail-fast の対象（v2 では対象を blocked に限定）
    return fail({ reason: "not_blocked", nodeId: op.nodeId, status: task.status });
  }
  return task;
}

/** verification_failed の reopen は「canonical が clean に戻った新しい観測」を要求する。 */
function assertObservedGitForVerificationFailed(op: ReopenOperation, fail: Fail): void {
  if (!op.observedGit) {
    fail({ reason: "canonical_clean_required", nodeId: op.nodeId });
    return;
  }
  if (op.observedGit.canonicalWorktree !== "clean") {
    fail({ reason: "observed_git_not_clean", nodeId: op.nodeId });
  }
}

/** forbidden kind と verification_failed の observedGit 前提条件を検査する。 */
function assertReopenConditions(target: ReopenableNode, op: ReopenOperation, fail: Fail) {
  const view = snapshotOf(target);
  if (view.forbiddenKind) {
    return fail({ reason: "reopen_forbidden", nodeId: op.nodeId, kind: view.forbiddenKind });
  }
  if (!view.isVerificationFailed) {
    if (op.observedGit) {
      return fail({ reason: "unnecessary_observed_git", nodeId: op.nodeId });
    }
    return view;
  }
  assertObservedGitForVerificationFailed(op, fail);
  return view;
}

function isReopenableTask(node: GraphNode): node is ReopenableNode {
  return node.kind === "task" && node.status === "blocked";
}

function isDoneTask(node: GraphNode): node is DoneTaskNode {
  return node.kind === "task" && node.status === "done";
}

export function reopen(graph: GraphV2, op: ReopenOperation): GraphV2 {
  const fail = (violation: ReopenPreconditionViolation): never => {
    throw new ReopenPreconditionError(violation);
  };
  const target = assertTaskTarget(graph, op, fail);
  const view = assertReopenConditions(target, op, fail);

  const reopenedAtRevision: Revision = revisionSchema.parse(graph.revision + 1);
  const record: ResolutionRecord = {
    previous: view.snapshot,
    resolution: op.resolution,
    reopenedAtRevision,
  };

  const toReopen = collectDoneDependentsTransitively(graph, op.nodeId);
  const nodes = graph.nodes.map((node): GraphNode => {
    if (!toReopen.has(node.id)) {
      return node;
    }
    if (node.id === op.nodeId && isReopenableTask(node)) {
      return pendingVariantOf(node, [...node.resolutions, record]);
    }
    if (isDoneTask(node)) {
      return pendingVariantOf(node, node.resolutions);
    }
    return node;
  });

  return finalizeTransaction({ ...graph, nodes });
}
