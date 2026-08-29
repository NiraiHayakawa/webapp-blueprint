// 「操作対象ノードの存在・種別の確認」を複数操作で共有する前提条件チェック。
//
// これはドメインのルールそのものであり、操作ごとに別々に書くべきではない。一方で、
// 違反時にどの reason 文字列でどのエラー型を投げるかは操作ごとに異なり、それは各操作の
// 公開契約（呼び出し側が操作ごとに catch して分岐できること）の一部である。そのため
// この関数はチェックの「形」だけを持ち、違反の組み立てと throw は呼び出し元に委譲する
// （throwViolation コールバックが never を返すため、呼び出し元の switch が
// 全ケースを処理していれば戻り値が型で narrow される）。
import type { GraphV2 } from "../graph.ts";
import type { GraphNode } from "../nodes.ts";

export type TaskLookupViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | { readonly reason: "not_a_task_node"; readonly nodeId: string };

/**
 * nodeId で task ノードを探す。無い / boundary ノードである（= Worker や Integrator は
 * claim できない。§2.1）場合は violation を callback へ渡す。
 */
export function requireTaskNode(
  graph: GraphV2,
  nodeId: string,
  throwViolation: (violation: TaskLookupViolation) => never,
): GraphNode & { readonly kind: "task" } {
  const target = graph.nodes.find((node) => node.id === nodeId);
  if (!target) {
    throwViolation({ reason: "node_not_found", nodeId });
  }
  if (target.kind !== "task") {
    throwViolation({ reason: "not_a_task_node", nodeId });
  }
  return target;
}
