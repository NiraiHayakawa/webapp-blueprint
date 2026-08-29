// abort: ノードを aborted にする（§2.7）。遷移元は pending / done / blocked であり、
// 実行中系（running / awaiting_integration / integrating）は abort できない
// （実行中ノードの回収は abandon_assignment / record_integration_outcome の責務）。
// start boundary は「機械操作だけが遷移させる」対象であり abort の対象外。
//
// aborted ノードは result / candidate / assignment / blockage を一切持たない
// （§2.7 の union 定義）。resolutions の履歴は追記専用のため保持する。
import type { GraphV2 } from "../graph.ts";
import { finalizeTransaction } from "../transaction.ts";
import type { GraphNode } from "../nodes.ts";
import { requireTaskNode } from "./task-node.ts";

export interface AbortOperation {
  readonly type: "abort";
  readonly nodeId: string;
}

export type AbortPreconditionViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | { readonly reason: "not_a_task_node"; readonly nodeId: string }
  | {
      readonly reason: "not_abortable";
      readonly nodeId: string;
      readonly status: "running" | "awaiting_integration" | "integrating" | "aborted";
    };

export class AbortPreconditionError extends Error {
  readonly violation: AbortPreconditionViolation;

  constructor(violation: AbortPreconditionViolation) {
    super(`abort の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "AbortPreconditionError";
    this.violation = violation;
  }
}

export function abort(graph: GraphV2, op: AbortOperation): GraphV2 {
  const fail = (violation: AbortPreconditionViolation): never => {
    throw new AbortPreconditionError(violation);
  };

  const target = requireTaskNode(graph, op.nodeId, fail);
  if (
    target.status === "running" ||
    target.status === "awaiting_integration" ||
    target.status === "integrating" ||
    target.status === "aborted"
  ) {
    return fail({ reason: "not_abortable", nodeId: op.nodeId, status: target.status });
  }

  const nodes = graph.nodes.map((node): GraphNode => {
    if (node.id !== op.nodeId || node.kind !== "task") {
      return node;
    }
    if (node.effect === "read_only") {
      return {
        kind: "task",
        id: node.id,
        title: node.title,
        deps: node.deps,
        resolutions: node.resolutions,
        purpose: "planned",
        effect: "read_only",
        status: "aborted",
      };
    }
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
      status: "aborted",
    };
  });

  return finalizeTransaction({ ...graph, nodes });
}
