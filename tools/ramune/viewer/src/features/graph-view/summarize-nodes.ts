import type { GraphNode, NodeStatus } from "../../lib/graph-source/graph-source.ts";

/**
 * ノード集合から、表示に必要な集計を1回の走査で作る。
 *
 * 「実行可能な pending」（kind が task、status が pending、かつ全 deps が done）
 * は ramune-graph の ready 選択と同じ条件であり、その先頭が「次に選ばれる
 * ノード」の表示になる。実際の選択・claim はドメイン層（ramune-graph）の責務で
 * あり、viewer は選択を行わない。ここでの実装は表示目的のためだけの独立な
 * 実装である（boundary ノードは claim されないため対象に含めない点も含む）。
 *
 * `counts` のキー順（pending → running → awaiting_integration → integrating →
 * blocked → aborted → done）はノードのライフサイクル順であり、一覧の表示順と
 * してそのまま使う。status の一覧をここ以外に持たせないため、初期化順が
 * 表示順を兼ねる。
 */
// 公開しない（名前で import する呼び出し元が無い。components/node-list は
// 集計結果を分解して受け取るため、components → features の依存を作らない）。
interface GraphSummary {
  readonly counts: Readonly<Record<NodeStatus, number>>;
  /** 実行可能な pending ノードの id。宣言順。 */
  readonly runnablePendingIds: readonly string[];
}

function createEmptyCounts() {
  // 戻り値に Record<NodeStatus, number> を注釈すると、7 つのキーが揃っている
  // という既知の事実が型から落ちる。satisfies なら網羅性は検査したまま、
  // リテラルの情報を残せる。
  return {
    pending: 0,
    running: 0,
    awaiting_integration: 0,
    integrating: 0,
    blocked: 0,
    aborted: 0,
    done: 0,
  } satisfies Record<NodeStatus, number>;
}

function summarizeNodes(nodes: readonly GraphNode[]): GraphSummary {
  const doneIds = new Set(nodes.filter((node) => node.status === "done").map((node) => node.id));
  const counts = createEmptyCounts();
  const runnablePendingIds: string[] = [];

  for (const node of nodes) {
    counts[node.status] += 1;
    if (
      node.kind === "task" &&
      node.status === "pending" &&
      node.deps.every((depId) => doneIds.has(depId))
    ) {
      runnablePendingIds.push(node.id);
    }
  }

  return { counts, runnablePendingIds };
}

export { summarizeNodes };
