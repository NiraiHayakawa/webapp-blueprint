// start_session: ramune モードを非稼働から稼働に切り替える（ramune_start MCP ツールの
// グラフ層）。session を { state: "active", runId, epoch: 0 } にし、runId の発番は
// 呼び出し側（サーバ）が行う。epoch は resume ごとに +1 される世代番号であり、
// 開始時は常に 0 から始まる。
//
// 同時に、start boundary を done に遷移させる（機械操作だけが boundary を遷移させられる。
// §2.1）。start は deps を持たないため、これ以降 start を依存する task ノードが
// ready になる。すでに done である場合（同じグラフでの2回目の ramune_start）は
// 過去の run の証跡を壊さないよう触らない。
//
// `ramune_start` MCP ツール以外からこの操作を組み立てられる経路は無い。セッションの
// 開始/終了は Planner/Worker の役割分離とは別の軸の権限であり、ramune_apply_ops の
// 操作列には含めない。
import type { GraphV2 } from "../graph.ts";
import { epochSchema, toNonEmptyString, type NonEmptyString, type RunId } from "../brand.ts";
import { finalizeTransaction } from "../transaction.ts";
import type { GraphNode, StartBoundaryNode } from "../nodes.ts";

/** 最初の epoch。resume のたびに +1 される。 */
export const INITIAL_EPOCH = epochSchema.parse(0);

const START_SUMMARY: NonEmptyString = toNonEmptyString("セッションを開始した");

export interface StartSessionOperation {
  readonly type: "start_session";
  /** サーバ（ramune_start ツール）が発番する run の識別子。 */
  readonly runId: RunId;
}

export interface StartSessionPreconditionViolation {
  readonly reason: "already_active";
}

export class StartSessionPreconditionError extends Error {
  readonly violation: StartSessionPreconditionViolation;

  constructor(violation: StartSessionPreconditionViolation) {
    super(`start_session の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "StartSessionPreconditionError";
    this.violation = violation;
  }
}

function isPendingStart(
  node: GraphNode,
): node is Extract<StartBoundaryNode, { status: "pending" }> {
  return node.kind === "boundary" && node.boundary === "start" && node.status === "pending";
}

export function startSession(graph: GraphV2, op: StartSessionOperation): GraphV2 {
  if (graph.session.state === "active") {
    throw new StartSessionPreconditionError({ reason: "already_active" });
  }

  const nodes = graph.nodes.map((node): GraphNode => {
    if (!isPendingStart(node)) {
      return node;
    }
    const done: StartBoundaryNode = {
      kind: "boundary",
      boundary: "start",
      id: node.id,
      title: node.title,
      deps: node.deps,
      status: "done",
      result: { kind: "boundary", runId: op.runId, summary: START_SUMMARY },
    };
    return done;
  });

  return finalizeTransaction({
    ...graph,
    session: { state: "active", runId: op.runId, epoch: INITIAL_EPOCH },
    nodes,
  });
}
