// insert_parallel_node: 既存エッジを要求せず、from に依存する newNode を新設し、
// to の deps へ newNode を追記する（既存 deps はそのまま残す）。
//
// insert_node は「既存エッジ from -> to を from -> newNode -> to に組み替える」splice
// 専用であり、edge_not_found を要求するため、素の start -> end 骨格（end.deps が
// ["start"] のみ）から独立な並列ノードを 2 本目以降作ることができない（1 本目の
// splice で edge start -> end が消え、2 本目が edge_not_found になる。設計正本
// docs/plan/Ramune/20260824_parallel-execution.md §8）。insert_parallel_node は
// 「to への新しい依存を追加する」fan-out 専用の構造操作として、edge の実在を前提条件
// にしないことでこれを可能にする。
//
// 「孤立ノードが構造的に発生しない」という insert_node と同じ設計意図は保たれる:
// newNode は必ず既存の from に依存し、to は必ず newNode にも依存するようになるため、
// newNode は常に start から到達可能な位置に生まれる。from が to から到達可能な場合は
// サイクルになり得るが、それは個別の前提条件ではなく finalizeTransaction が呼ぶ
// 不変条件検査（cycle-detection）で拒否される（他の構造操作と同じ責務分担）。
//
// to は「end boundary」または「pending の task」に限定する。実行中系
// （running / awaiting_integration / integrating）・blocked・aborted・done の
// ノードの deps を機械操作で書き換えると、既に発番済みの assignment や候補が
// 参照する依存関係の前提が壊れるため、対象外にする。
import type { GraphV2 } from "../graph.ts";
import {
  RESERVED_END_NODE_ID,
  RESERVED_START_NODE_ID,
  generatedNodeIdSchema,
  plannedNodeIdSchema,
  type GeneratedNodeId,
  type NonEmptyString,
  type PlannedNodeId,
} from "../brand.ts";
import { finalizeTransaction } from "../transaction.ts";
import type { GraphNode, RepositoryNode, ReadOnlyNode } from "../nodes.ts";
import type { EndBoundaryNode } from "../boundary-nodes.ts";

// similarity-ignore: InsertNodeOperation（insert-node.ts）と from/to/newNode の形が
// ほぼ一致するが、意図的に別の公開契約である。insert_node は既存エッジの実在を要求する
// splice 専用、insert_parallel_node はエッジの実在を要求しない fan-out 専用であり、
// 前提条件（InsertNodePreconditionViolation / InsertParallelNodePreconditionViolation）
// と効果が異なる。共有型に統合すると呼び出し側が2つの操作を区別する根拠を失う。
export interface InsertParallelNodeOperation {
  readonly type: "insert_parallel_node";
  readonly from: string;
  readonly to: string;
  readonly newNode: {
    readonly id: PlannedNodeId;
    readonly title: NonEmptyString;
    readonly effect: "read_only" | "repository_change";
  };
}

export type InsertParallelNodePreconditionViolation =
  | { readonly reason: "from_not_found"; readonly from: string }
  | { readonly reason: "to_not_found"; readonly to: string }
  | { readonly reason: "from_equals_to"; readonly nodeId: string }
  | { readonly reason: "from_not_allowed"; readonly from: string }
  | { readonly reason: "to_not_allowed"; readonly to: string }
  | { readonly reason: "duplicate_new_id"; readonly id: string };

export class InsertParallelNodePreconditionError extends Error {
  readonly violation: InsertParallelNodePreconditionViolation;

  constructor(violation: InsertParallelNodePreconditionViolation) {
    super(`insert_parallel_node の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "InsertParallelNodePreconditionError";
    this.violation = violation;
  }
}

type Fail = (violation: InsertParallelNodePreconditionViolation) => never;

/** to に許されるノード（end boundary、または pending の task）。 */
type ParallelTarget =
  | EndBoundaryNode
  | Extract<ReadOnlyNode, { readonly status: "pending" }>
  | Extract<RepositoryNode, { readonly status: "pending" }>;

function isParallelTarget(node: GraphNode): node is ParallelTarget {
  if (node.kind === "boundary") {
    return node.boundary === "end";
  }
  return node.status === "pending";
}

/**
 * from ノードの実在と、from に許される形（end 以外）を検査する。end はシンクである
 * （誰も依存できない）ため、from にはなれない。
 */
function findFromNode(graph: GraphV2, op: InsertParallelNodeOperation, fail: Fail): GraphNode {
  if (op.from === RESERVED_END_NODE_ID) {
    return fail({ reason: "from_not_allowed", from: op.from });
  }
  const fromNode = graph.nodes.find((node) => node.id === op.from);
  if (!fromNode) {
    return fail({ reason: "from_not_found", from: op.from });
  }
  return fromNode;
}

/** to ノードの実在と、fan-out 先として許される形（end boundary / pending task）を検査する。 */
function findToTarget(graph: GraphV2, op: InsertParallelNodeOperation, fail: Fail): ParallelTarget {
  const toNode = graph.nodes.find((node) => node.id === op.to);
  if (!toNode) {
    return fail({ reason: "to_not_found", to: op.to });
  }
  if (!isParallelTarget(toNode)) {
    return fail({ reason: "to_not_allowed", to: op.to });
  }
  return toNode;
}

/**
 * `from`（findFromNode で end ではないことを確認済みの ID）を、newNode.deps の
 * 要素型（GeneratedNodeId | PlannedNodeId | "start"）へ検証しながら絞り込む
 * （insert-node.ts の toExistingDepsElement と同じ契約・同じ実装形）。
 */
// similarity-ignore: insert-node.ts の toExistingDepsElement と実装が一致するが、Fail の型
// （InsertNodePreconditionViolation / InsertParallelNodePreconditionViolation）が operation
// ごとに異なる判別共用体であり、ジェネリクスで共通化すると呼び出し元のエラー型の
// narrowing を失う。
function toExistingDepsElement(
  from: string,
  fail: Fail,
): GeneratedNodeId | PlannedNodeId | typeof RESERVED_START_NODE_ID {
  if (from === RESERVED_START_NODE_ID) {
    return from;
  }
  const generated = generatedNodeIdSchema.safeParse(from);
  if (generated.success) {
    return generated.data;
  }
  const planned = plannedNodeIdSchema.safeParse(from);
  if (planned.success) {
    return planned.data;
  }
  return fail({ reason: "from_not_allowed", from });
}

/** from = to の禁止と、newNode.id の重複禁止を検査する。 */
function assertInsertable(graph: GraphV2, op: InsertParallelNodeOperation, fail: Fail): void {
  if (op.from === op.to) {
    fail({ reason: "from_equals_to", nodeId: op.from });
  }
  if (graph.nodes.some((node) => node.id === op.newNode.id)) {
    fail({ reason: "duplicate_new_id", id: op.newNode.id });
  }
}

/** to.deps へ newNode.id を追記する（既存 deps は変更しない）。 */
function appendDep(target: ParallelTarget, newNodeId: PlannedNodeId): ParallelTarget {
  return { ...target, deps: [...target.deps, newNodeId] };
}

export function insertParallelNode(graph: GraphV2, op: InsertParallelNodeOperation): GraphV2 {
  const fail = (violation: InsertParallelNodePreconditionViolation): never => {
    throw new InsertParallelNodePreconditionError(violation);
  };

  findFromNode(graph, op, fail);
  const toTarget = findToTarget(graph, op, fail);
  assertInsertable(graph, op, fail);
  const depsElement = toExistingDepsElement(op.from, fail);

  const inserted: RepositoryNode | ReadOnlyNode = {
    kind: "task",
    id: op.newNode.id,
    title: op.newNode.title,
    deps: [depsElement],
    resolutions: [],
    purpose: "planned",
    effect: op.newNode.effect,
    status: "pending",
  };

  const nodes = graph.nodes.map((node) => {
    if (node.id !== op.to) {
      return node;
    }
    return appendDep(toTarget, op.newNode.id);
  });

  return finalizeTransaction({ ...graph, nodes: [...nodes, inserted] });
}
