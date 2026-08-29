// `.ramune/graph.json` の取得口。
//
// viewer は ramune の実行に一切関与しない（読み取り専用）。実行のロジック
// （claim・状態遷移など）はドメイン層（ramune-graph / mcp-server）の責務であり、
// viewer から呼ばない。`.ramune/graph.json` の形も viewer が独自に決めてよい
// 事柄ではなく ramune 側の契約そのものであるため、形の検証はドメイン層の
// スキーマ（`parseGraph`）に一本化し、viewer が独自に持つのは「どこから取って
// くるか」だけにする。ファイルを一切書き込まないことも読み取り専用の要件。
import { parseGraph } from "@webapp-blueprint/ramune-graph";
import type { GraphNode, GraphV2 } from "@webapp-blueprint/ramune-graph";

export { parseGraph } from "@webapp-blueprint/ramune-graph";
export type { GraphNode, GraphV2 } from "@webapp-blueprint/ramune-graph";

/**
 * グラフノードの status 全値。GraphNode（discriminated union）からの導出なので、
 * 契約側の status の追加・変更に自動追従する。
 */
type NodeStatus = GraphNode["status"];

export type { NodeStatus };

const GRAPH_ENDPOINT = "/graph.json";
const NOT_FOUND_STATUS = 404;

/**
 * .ramune/graph.json の取得結果。「ramune をまだ一度も実行していない」ことは
 * 正当な状態であり、壊れたグラフ（形が不正）と同じ扱いで例外にはしない
 * （fail-fast の対象は「失敗を隠すこと」であり、「まだ存在しない」という
 * 事実を呼び出し側に判別可能な形で伝えることはこれに反しない。
 * docs/principles/fail-fast.md）。壊れたグラフ・ネットワーク層の失敗は
 * `fetchGraph()` の reject（例外）として fail-fast する。
 */
type GraphFetchResult =
  | { readonly found: true; readonly graph: GraphV2 }
  | { readonly found: false };

interface GraphSource {
  readonly fetchGraph: () => Promise<GraphFetchResult>;
}

async function fetchGraphFromEndpoint(): Promise<GraphFetchResult> {
  const response = await fetch(GRAPH_ENDPOINT);
  if (response.status === NOT_FOUND_STATUS) {
    // tools/ramune/viewer/vite.config.ts のミドルウェアが .ramune/graph.json 不在を
    // 404 として返す（ramune をまだ実行していない、という正当な状態）。
    // ここでは例外にせず、呼び出し側（features/graph-view）が「グラフが
    // まだありません」という状態として扱えるようにする。
    return { found: false };
  }
  if (!response.ok) {
    throw new Error(`${GRAPH_ENDPOINT} の取得に失敗した（status: ${response.status}）`);
  }

  // `response.json()` ではなく `response.text()` を使い、JSON の解析ごと
  // `parseGraph` に渡す。検証前の値が viewer 側の変数として一度も姿を
  // 現さないため、検証を飛ばした使い方が書けない。
  return { found: true, graph: parseGraph(await response.text()) };
}

/**
 * .ramune/graph.json の取得口。実体は tools/ramune/viewer/vite.config.ts の
 * ミドルウェアがリポジトリ直下の .ramune/graph.json を都度中継する静的
 * エンドポイントであり、viewer はファイルを一切書き込まない（読み取り専用）。
 */
function createGraphSource(): GraphSource {
  return { fetchGraph: fetchGraphFromEndpoint };
}

export type { GraphSource };
export { createGraphSource };
