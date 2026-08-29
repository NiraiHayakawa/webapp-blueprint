// record_result: read_only ノードを running → done にする（ramune_record_result の
// グラフ層。v1 の set_result を置き換える）。fence の完全一致を要求し、一致しない
// 書き込みは stale fence として拒否される（§3）。
//
// repository_change ノードには使えない。そちらの完了は candidate 提出と統合を
// 経由し、完了証跡は record_integration_outcome が書く（§6）。
import type { GraphV2 } from "../graph.ts";
import { jsonValueSchema, type JsonValue, type NonEmptyString } from "../brand.ts";
import { finalizeTransaction } from "../transaction.ts";
import { fenceOf, sameFence, type AssignmentFence } from "../assignment.ts";
import type { GraphNode, ReadOnlyNode } from "../nodes.ts";

export interface RecordResultOperation {
  readonly type: "record_result";
  readonly nodeId: string;
  readonly fence: AssignmentFence;
  readonly report: {
    readonly summary: NonEmptyString;
    readonly data: JsonValue;
  };
}

export type RecordResultPreconditionViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | { readonly reason: "not_read_only_node"; readonly nodeId: string }
  | { readonly reason: "not_running"; readonly nodeId: string; readonly status: string }
  | {
      readonly reason: "stale_fence";
      readonly nodeId: string;
      readonly presentedFence: AssignmentFence;
    };

export class RecordResultPreconditionError extends Error {
  readonly violation: RecordResultPreconditionViolation;

  constructor(violation: RecordResultPreconditionViolation) {
    super(`record_result の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "RecordResultPreconditionError";
    this.violation = violation;
  }
}

function throwRecordResultPreconditionError(violation: RecordResultPreconditionViolation): never {
  throw new RecordResultPreconditionError(violation);
}

type RunningReadOnlyNode = Extract<ReadOnlyNode, { readonly status: "running" }>;

function isRunningReadOnly(node: GraphNode): node is RunningReadOnlyNode {
  return node.kind === "task" && node.effect === "read_only" && node.status === "running";
}

function requireSameFence(
  stored: AssignmentFence,
  presented: AssignmentFence,
  nodeId: string,
): void {
  if (!sameFence(stored, presented)) {
    throwRecordResultPreconditionError({
      reason: "stale_fence",
      nodeId,
      presentedFence: presented,
    });
  }
}

// similarity-ignore: 各操作の finder は fail-fast の前提条件イディオムとして意図的に
// 並行構造を持つ。narrowing 先の型と precondition エラーの reason union が操作ごとの
// 公開契約であり、ジェネリクスで統合すると契約の判読性を失う（設計判断。wp8.md 参照）。
function findRunningTarget(graph: GraphV2, op: RecordResultOperation): RunningReadOnlyNode {
  const target = graph.nodes.find((node) => node.id === op.nodeId);
  if (!target) {
    return throwRecordResultPreconditionError({ reason: "node_not_found", nodeId: op.nodeId });
  }
  if (target.kind !== "task" || target.effect !== "read_only") {
    return throwRecordResultPreconditionError({ reason: "not_read_only_node", nodeId: op.nodeId });
  }
  if (target.status !== "running") {
    return throwRecordResultPreconditionError({
      reason: "not_running",
      nodeId: op.nodeId,
      status: target.status,
    });
  }
  return target;
}

export function recordResult(graph: GraphV2, op: RecordResultOperation): GraphV2 {
  const target = findRunningTarget(graph, op);
  requireSameFence(target.assignment, op.fence, op.nodeId);

  const nodes = graph.nodes.map((node): GraphNode => {
    if (node.id !== op.nodeId || !isRunningReadOnly(node)) {
      return node;
    }
    return {
      kind: "task",
      id: node.id,
      title: node.title,
      deps: node.deps,
      resolutions: node.resolutions,
      purpose: "planned",
      effect: "read_only",
      status: "done",
      result: {
        kind: "read_only",
        summary: op.report.summary,
        data: jsonValueSchema.parse(op.report.data),
        completedBy: fenceOf(target.assignment),
      },
    };
  });

  return finalizeTransaction({ ...graph, nodes });
}
