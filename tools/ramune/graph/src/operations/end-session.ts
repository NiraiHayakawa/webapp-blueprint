// end_session: ramune モードを稼働から非稼働に切り替える（ramune_end MCP ツールの
// グラフ層）。グラフ自体は削除・変更せず、session を非稼働に戻すだけである
// （再度 ramune_start すれば同じグラフの続きから稼働できる）。
//
// 実行中のノード（running / awaiting_integration / integrating）が 1 件でもあれば
// 拒否する（§8 の ramune_end の契約）。終了判定そのものは Planner が行う（ADR 0001）。
//
// 同時に、end boundary の deps がすべて done なら end を done に遷移させ run の
// 証跡を書く（機械操作だけが boundary を遷移させられる。§2.1）。deps が揃って
// いない場合（aborted / blocked な分岐が残る場合）は pending のまま残す。
// 嘘の証跡を書かないことが優先であり、end の完了は終了条件ではない。
import type { GraphV2 } from "../graph.ts";
import { toNonEmptyString, type NonEmptyString } from "../brand.ts";
import { finalizeTransaction } from "../transaction.ts";
import type { EndBoundaryNode, GraphNode } from "../nodes.ts";

export interface EndSessionOperation {
  readonly type: "end_session";
}

export type EndSessionPreconditionViolation =
  | { readonly reason: "already_inactive" }
  | {
      readonly reason: "unfinished_nodes_exist";
      readonly nodeIds: readonly string[];
    };

export class EndSessionPreconditionError extends Error {
  readonly violation: EndSessionPreconditionViolation;

  constructor(violation: EndSessionPreconditionViolation) {
    super(`end_session の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "EndSessionPreconditionError";
    this.violation = violation;
  }
}

const SUMMARY: NonEmptyString = toNonEmptyString("セッションを終了した");

function isPendingEnd(node: GraphNode): node is Extract<EndBoundaryNode, { status: "pending" }> {
  return node.kind === "boundary" && node.boundary === "end" && node.status === "pending";
}

function isDone(graph: GraphV2, nodeId: string): boolean {
  return graph.nodes.some((node) => node.id === nodeId && node.status === "done");
}

export function endSession(graph: GraphV2, _op: EndSessionOperation): GraphV2 {
  if (graph.session.state !== "active") {
    throw new EndSessionPreconditionError({ reason: "already_inactive" });
  }

  const unfinished = graph.nodes
    .filter(
      (node) =>
        node.kind === "task" &&
        (node.status === "running" ||
          node.status === "awaiting_integration" ||
          node.status === "integrating"),
    )
    .map((node) => node.id);
  if (unfinished.length > 0) {
    throw new EndSessionPreconditionError({
      reason: "unfinished_nodes_exist",
      nodeIds: unfinished,
    });
  }

  const { session } = graph;
  const nodes = graph.nodes.map((node): GraphNode => {
    if (!isPendingEnd(node)) {
      return node;
    }
    if (!node.deps.every((depId) => isDone(graph, depId))) {
      return node;
    }
    const done: Extract<EndBoundaryNode, { status: "done" }> = {
      kind: "boundary",
      boundary: "end",
      id: node.id,
      title: node.title,
      deps: node.deps,
      status: "done",
      result: {
        kind: "boundary",
        runId: session.runId,
        summary: SUMMARY,
      },
    };
    return done;
  });

  return finalizeTransaction({ ...graph, session: { state: "inactive" }, nodes });
}
