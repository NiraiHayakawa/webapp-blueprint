// ready ノードの決定的選択（設計正本 §3）。
//
// 「status が pending かつ全 deps が done」の task ノードを、ノード配列の宣言順
// （挿入順）で最大 limit 件選ぶ。遷移（pending → running と fence の書き込み）は
// operations 側の責務であり、この関数は選択だけを行う純関数である。
//
// 選べるノードが無い場合は空配列を返す。「全ノードが完了した」場合も「一部の
// ノードが aborted / blocked な依存先待ちで永久に選べない」場合も、ドメイン層は
// この2つを区別しない。グラフ全体としてゴールが達成されたかどうかの判定は
// Planner（LLM）の仕事である（docs/adr/0001-ramune-architecture.md「決定的な終了判定を
// 実装しない」）。
import type { GraphV2 } from "./graph.ts";
import type { GraphNode, RepositoryNode, ReadOnlyNode } from "./nodes.ts";

export class InvalidReadyLimitError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`limit は正の整数でなければならない: limit=${String(limit)}`);
    this.name = "InvalidReadyLimitError";
    this.limit = limit;
  }
}

type TaskNode = ReadOnlyNode | RepositoryNode;

/** ready（pending かつ全 deps done）な task ノード。 */
export type ReadyTaskNode =
  | Extract<ReadOnlyNode, { readonly status: "pending" }>
  | Extract<RepositoryNode, { readonly status: "pending" }>;

function isTaskNode(node: GraphNode): node is TaskNode {
  return node.kind === "task";
}

/**
 * 宣言順で ready な task ノードを最大 limit 件返す。boundary ノードは機械操作だけが
 * 遷移させるため選ばない（§2.1）。
 */
function assertValidLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new InvalidReadyLimitError(limit);
  }
}

function isReadyNode(node: TaskNode, doneIds: ReadonlySet<string>): node is ReadyTaskNode {
  return node.status === "pending" && node.deps.every((depId) => doneIds.has(depId));
}

/**
 * 宣言順で ready な task ノードを最大 limit 件返す。boundary ノードは機械操作だけが
 * 遷移させるため選ばない（§2.1）。
 */
export function selectReadyNodes(graph: GraphV2, limit: number): readonly ReadyTaskNode[] {
  assertValidLimit(limit);

  const doneIds = new Set<string>(
    graph.nodes.filter((node) => node.status === "done").map((node) => node.id),
  );

  const selected: ReadyTaskNode[] = [];
  for (const node of graph.nodes) {
    if (selected.length >= limit) {
      break;
    }
    if (isTaskNode(node) && isReadyNode(node, doneIds)) {
      selected.push(node);
    }
  }
  return selected;
}
