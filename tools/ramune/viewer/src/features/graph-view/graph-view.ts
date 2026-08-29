import type { GraphSource } from "../../lib/graph-source/graph-source.ts";
import { renderGraphDiagram } from "../../components/graph-diagram/graph-diagram.ts";
import { renderNoGraphState } from "../../components/graph-diagram/no-graph-state.ts";
import { renderNodeList } from "../../components/node-list/node-list.ts";
import { renderSessionBadge } from "../../components/session-badge/session-badge.ts";
import { summarizeNodes } from "./summarize-nodes.ts";

export interface LoadGraphViewInput {
  readonly graphSource: GraphSource;
  /**
   * 詳細を開いているノードの id。ブラウザの URL（フラグメント）から呼び出し側が
   * 解決して渡す（feature が `location` を直接触らない = テストで環境を作らずに済む）。
   */
  readonly selectedNodeId: string | undefined;
}

/**
 * API 境界（lib/graph-source）を経由するため feature に区分する（design 指示
 * の判定基準:「テストに API モックが要るなら feature」）。
 *
 * `.ramune/graph.json` がまだ存在しない（`found: false`）ことは「ramune を
 * 一度も実行していない」正当な状態であり、壊れたグラフとは区別して
 * 「グラフがまだありません」という表示に倒す（silent fallback ではない。
 * lib/graph-source/graph-source.ts の GraphFetchResult のコメント参照）。
 * 壊れたグラフ・取得自体の失敗は `fetchGraph()` の reject として伝播し、
 * ここでは握りつぶさない（呼び出し元 routes/index.ts → main.ts が
 * fail-fast で表示する）。
 */
export async function loadGraphView(input: Readonly<LoadGraphViewInput>): Promise<string> {
  const result = await input.graphSource.fetchGraph();
  if (!result.found) {
    return renderNoGraphState();
  }

  const { graph } = result;
  const summary = summarizeNodes(graph.nodes);
  // 実行可能な pending の先頭が「次に選ばれるノード」の表示になる
  // （ready 選択と同じ条件・宣言順。summarize-nodes.ts 参照）。
  const [nextNodeId] = summary.runnablePendingIds;

  return [
    renderSessionBadge(graph.session),
    renderGraphDiagram({ graph, nextNodeId }),
    renderNodeList({
      nodes: graph.nodes,
      counts: summary.counts,
      runnablePendingIds: summary.runnablePendingIds,
      nextNodeId,
      selectedNodeId: input.selectedNodeId,
    }),
  ].join("\n");
}
