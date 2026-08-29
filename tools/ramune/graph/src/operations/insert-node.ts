// insert_node: 既存エッジ from -> to を from -> newNode -> to に組み替えて挿入する。
//
// 「孤立ノードが構造的に発生しない」のがこの操作形の要点（docs/adr/0001-ramune-architecture.md
// 却下した代替案2）。newNode は必ず既存の from に依存し、to は必ず newNode に依存するよう
// 組み替えられるため、newNode は常に start から到達可能な位置に生まれる。
//
// v2 では newNode の effect（read_only / repository_change）を Planner が指定し、
// purpose: planned の task ノードとして挿入される。newNode の ID は Planner が選ぶ
// PlannedNodeId であり、start / end / 機械生成名前空間（gen-*）は拒否される
// （§2.5。スキーマ plannedNodeIdSchema も同じ契約を持つが、操作の前提条件としても
// 検査する。スキーマは「ファイルとして読んだグラフ」の入口、ここは「操作入力」の
// 入口であり、どちらか片方だけの検査ではもう一方の経路が素通りするため）。
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
import type { StartBoundaryNode } from "../boundary-nodes.ts";

// similarity-ignore: InsertParallelNodeOperation（insert-parallel-node.ts）と
// from/to/newNode の形がほぼ一致するが、意図的に別の公開契約である（理由は
// insert-parallel-node.ts 側のコメント参照）。
export interface InsertNodeOperation {
  readonly type: "insert_node";
  readonly from: string;
  readonly to: string;
  readonly newNode: {
    readonly id: PlannedNodeId;
    readonly title: NonEmptyString;
    readonly effect: "read_only" | "repository_change";
  };
}

export type InsertNodePreconditionViolation =
  | { readonly reason: "to_not_found"; readonly to: string }
  | { readonly reason: "from_not_allowed"; readonly from: string }
  | { readonly reason: "to_not_allowed"; readonly to: string }
  | { readonly reason: "edge_not_found"; readonly from: string; readonly to: string }
  | { readonly reason: "duplicate_new_id"; readonly id: string }
  | { readonly reason: "reserved_new_id"; readonly id: string }
  | { readonly reason: "generated_new_id"; readonly id: string };

export class InsertNodePreconditionError extends Error {
  readonly violation: InsertNodePreconditionViolation;

  constructor(violation: InsertNodePreconditionViolation) {
    super(`insert_node の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "InsertNodePreconditionError";
    this.violation = violation;
  }
}

/**
 * deps を書き換えられるノード（start 以外の全ノード）。start の deps は常に空という
 * 不変条件があり、書き換え操作の対象になり得ない。
 */
type NodeWithReplaceableDeps = Exclude<GraphNode, StartBoundaryNode>;

/** start 以外（deps を書き換えてよいノード）かどうかを判定する型ガード。 */
function isReplaceableDepsNode(node: GraphNode): node is NodeWithReplaceableDeps {
  return !(node.kind === "boundary" && node.boundary === "start");
}

/** deps の要素型を保ったまま組み替える（boundary ノードの deps も通すための共用版）。 */
function rewireDepsPreserving(
  node: NodeWithReplaceableDeps,
  from: string,
  newNodeId: PlannedNodeId,
): NodeWithReplaceableDeps {
  return {
    ...node,
    deps: node.deps.map((depId) => (depId === from ? newNodeId : depId)),
  };
}

type Fail = (violation: InsertNodePreconditionViolation) => never;

/** 挿入先エッジ（from → to）の存在と、from / to に許されるノードの検査。 */
// similarity-ignore: 各操作の finder は fail-fast の前提条件イディオムとして意図的に
// 並行構造を持つ。narrowing 先の型と precondition エラーの reason union が操作ごとの
// 公開契約であり、ジェネリクスで統合すると契約の判読性を失う（設計判断。wp8.md 参照）。
function findToNodeAndAssertEdge(graph: GraphV2, op: InsertNodeOperation, fail: Fail) {
  const toNode = graph.nodes.find((node) => node.id === op.to);
  if (!toNode) {
    return fail({ reason: "to_not_found", to: op.to });
  }
  if (op.from === RESERVED_END_NODE_ID || op.from === op.to) {
    // end はシンクである（誰も依存できない）ため、from にはなれない
    return fail({ reason: "from_not_allowed", from: op.from });
  }
  if (op.to === RESERVED_START_NODE_ID) {
    // start の deps は常に空という不変条件があるため、to にはなれない
    return fail({ reason: "to_not_allowed", to: op.to });
  }
  // SAFETY: deps の要素型（GeneratedNodeId | PlannedNodeId | "start"）はいずれも
  // string のブランド型であり、string としての比較（includes）に対して安全に扱える
  if (!(toNode.deps as readonly string[]).includes(op.from)) {
    return fail({ reason: "edge_not_found", from: op.from, to: op.to });
  }
  return toNode;
}

/**
 * `from`（既存ノードの deps に実在することを確認済みの ID）を、実際の型
 * （GeneratedNodeId | PlannedNodeId | "start"）へ検証しながら絞り込む。
 * ノード ID は生成時点でこのいずれかの形にしかなり得ないため、検証に失敗する
 * ことは論理的に起こらないが、fail fast のため実際に parse して確定させる。
 */
// similarity-ignore: insert-parallel-node.ts の toExistingDepsElement と実装が一致するが、
// Fail の型（InsertNodePreconditionViolation / InsertParallelNodePreconditionViolation）が
// operation ごとに異なる判別共用体であり、ジェネリクスで共通化すると呼び出し元の
// エラー型の narrowing を失う（本ファイル冒頭の各 find* と同じ設計判断）。
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

export function insertNode(graph: GraphV2, op: InsertNodeOperation): GraphV2 {
  const fail = (violation: InsertNodePreconditionViolation): never => {
    throw new InsertNodePreconditionError(violation);
  };

  findToNodeAndAssertEdge(graph, op, fail);
  if (graph.nodes.some((node) => node.id === op.newNode.id)) {
    return fail({ reason: "duplicate_new_id", id: op.newNode.id });
  }

  const inserted: RepositoryNode | ReadOnlyNode = {
    kind: "task",
    id: op.newNode.id,
    title: op.newNode.title,
    deps: [toExistingDepsElement(op.from, fail)],
    resolutions: [],
    purpose: "planned",
    effect: op.newNode.effect,
    status: "pending",
  };

  const nodes = graph.nodes.map((node) => {
    if (node.id !== op.to) {
      return node;
    }
    if (!isReplaceableDepsNode(node)) {
      return fail({ reason: "to_not_allowed", to: op.to });
    }
    return rewireDepsPreserving(node, op.from, op.newNode.id);
  });

  return finalizeTransaction({ ...graph, nodes: [...nodes, inserted] });
}
