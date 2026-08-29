import type { GraphV2, GraphNode, NodeStatus } from "../../lib/graph-source/graph-source.ts";
import {
  NODE_RADIUS,
  type NodeLayout,
  computeLayout,
  computeViewBox,
  getLayoutOrThrow,
} from "./graph-layout.ts";
import { escapeHtml, formatNodeResult } from "../../lib/node-text/node-text.ts";

interface GraphDiagramProps {
  readonly graph: GraphV2;
  readonly nextNodeId: string | undefined;
}

/** ツールチップは1行に詰める（`JSON.stringify` の第3引数）。一覧側は 2 を渡す。 */
const TOOLTIP_INDENT_SPACES = 0;
const HALO_MARGIN = 8;
const HALO_RADIUS = NODE_RADIUS + HALO_MARGIN;
const LABEL_OFFSET = 8;
const LABEL_FONT_HALF_HEIGHT = 6;
// ラベルはノードの真下に中央揃えで置く。右横に置くと次の列のノードと重なり、
// 実グラフ（Planner が付ける長いタイトル）では読めなくなる（2026-08-10 に実測）。
const LABEL_BASELINE_OFFSET = NODE_RADIUS + LABEL_OFFSET + LABEL_FONT_HALF_HEIGHT;
// 列幅に収まる長さで切り詰める。全文はツールチップと components/node-list が
// 持つため、ここで情報は失われない。
const LABEL_MAX_LENGTH = 12;
const BLOCKED_TRIANGLE_MARGIN = 2;
const BLOCKED_TRIANGLE_HALF_WIDTH_RATIO = 0.87;
const BLOCKED_TRIANGLE_HALF_HEIGHT_RATIO = 0.5;

function statusGlyph(status: NodeStatus): string {
  if (status === "done") {
    return "✓";
  }
  if (status === "aborted") {
    return "✕";
  }
  if (status === "blocked") {
    return "!";
  }
  return "";
}

/**
 * blocked は上向き三角形（円=pending/done・回転した正方形=aborted のどちらとも
 * 異なる形）で描く。「他の status と区別できる色・形で表示する」という設計指示
 * を満たすため、色（amber系）だけでなく形自体も他の3状態と重複させない。
 */
function trianglePoints(layout: Readonly<NodeLayout>): string {
  const { x, y } = layout;
  const r = NODE_RADIUS + BLOCKED_TRIANGLE_MARGIN;
  const halfWidth = r * BLOCKED_TRIANGLE_HALF_WIDTH_RATIO;
  const halfHeight = r * BLOCKED_TRIANGLE_HALF_HEIGHT_RATIO;
  const top = `${x},${y - r}`;
  const bottomRight = `${x + halfWidth},${y + halfHeight}`;
  const bottomLeft = `${x - halfWidth},${y + halfHeight}`;
  return [top, bottomRight, bottomLeft].join(" ");
}

function renderNodeMark(layout: Readonly<NodeLayout>): string {
  const { status } = layout.node;
  if (status === "aborted") {
    const side = NODE_RADIUS * 2;
    return `<rect class="node-shape node-aborted" x="${layout.x - NODE_RADIUS}" y="${layout.y - NODE_RADIUS}" width="${side}" height="${side}" transform="rotate(45 ${layout.x} ${layout.y})" />`;
  }
  if (status === "blocked") {
    return `<polygon class="node-shape node-blocked" points="${trianglePoints(layout)}" />`;
  }
  // 実行・統合の進行中（running / awaiting_integration / integrating）は
  // pending / done と同じ円で、class（= 塗り色）だけが異なる。
  return `<circle class="node-shape node-${status}" cx="${layout.x}" cy="${layout.y}" r="${NODE_RADIUS}" />`;
}

function renderNodeHalo(layout: Readonly<NodeLayout>, isNext: boolean): string {
  if (!isNext) {
    return "";
  }
  return `<circle class="node-halo" cx="${layout.x}" cy="${layout.y}" r="${HALO_RADIUS}" />`;
}

function buildTooltipText(node: Readonly<GraphNode>): string {
  const lines: string[] = [node.title];
  if (node.status === "blocked") {
    lines.push(`blocked: ${node.blockage.reason}`);
  }
  if (node.status === "done") {
    lines.push(formatNodeResult(node.result, TOOLTIP_INDENT_SPACES));
  }
  return lines.join("\n");
}

function truncateLabel(title: string): string {
  return title.length <= LABEL_MAX_LENGTH ? title : `${title.slice(0, LABEL_MAX_LENGTH)}…`;
}

function renderNode(layout: Readonly<NodeLayout>, nextNodeId: string | undefined): string {
  const { node } = layout;
  const isNext = node.id === nextNodeId;
  const labelY = layout.y + LABEL_BASELINE_OFFSET;

  return `<g class="node node-${node.status}" data-node-id="${escapeHtml(node.id)}" data-next-node="${String(isNext)}">
    ${renderNodeHalo(layout, isNext)}
    ${renderNodeMark(layout)}
    <text class="node-glyph" x="${layout.x}" y="${layout.y}">${statusGlyph(node.status)}</text>
    <text class="node-label" x="${layout.x}" y="${labelY}">${escapeHtml(truncateLabel(node.title))}</text>
    <title>${escapeHtml(buildTooltipText(node))}</title>
  </g>`;
}

function renderEdge(from: Readonly<NodeLayout>, to: Readonly<NodeLayout>): string {
  return `<line class="edge" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" marker-end="url(#arrow)" />`;
}

function renderEdgesFrom(
  layout: Readonly<NodeLayout>,
  layoutById: ReadonlyMap<string, NodeLayout>,
): string {
  return layout.node.deps
    .map((depId) => renderEdge(getLayoutOrThrow(layoutById, depId), layout))
    .join("\n");
}

function renderEdges(layouts: readonly NodeLayout[]): string {
  const layoutById = new Map(
    layouts.map((layout): readonly [string, NodeLayout] => [layout.node.id, layout]),
  );
  return layouts.map((layout) => renderEdgesFrom(layout, layoutById)).join("\n");
}

function renderLegend(): string {
  return `<ul class="legend">
    <li class="legend-item"><span class="legend-swatch node-pending"></span>pending</li>
    <li class="legend-item"><span class="legend-swatch node-running"></span>running</li>
    <li class="legend-item"><span class="legend-swatch node-awaiting_integration"></span>awaiting_integration</li>
    <li class="legend-item"><span class="legend-swatch node-integrating"></span>integrating</li>
    <li class="legend-item"><span class="legend-swatch node-blocked"></span>blocked</li>
    <li class="legend-item"><span class="legend-swatch node-aborted"></span>aborted</li>
    <li class="legend-item"><span class="legend-swatch node-done"></span>done</li>
    <li class="legend-item"><span class="legend-swatch legend-halo-swatch"></span>次に選ばれるノード</li>
  </ul>`;
}

function renderEmptyState(graph: Readonly<GraphV2>): string {
  return `<div class="graph-diagram graph-diagram-empty">
    <h1>${escapeHtml(graph.goal)}</h1>
    <p>ノードがありません</p>
  </div>`;
}

// 凡例の見本は SVG ではなく <span> で描くため、fill/stroke ではなく background が
// 効く。node-* クラスを使い回すだけでは色が付かず見本が透明になっていた
// （2026-08-10 に実測）ので、legend-swatch 側で status ごとに background を明示する。
//
// h1 の font-size を落としているのは、goal が「1行の見出し」ではなく長い文章になる
// （タイトルが長文になるケースを許容するため）。既定の h1 サイズでは画面を占有する。
const STYLE = `<style>
  .graph-diagram { font-family: system-ui, sans-serif; color: #1f2937; }
  .graph-diagram h1 { font-size: 16px; font-weight: 600; line-height: 1.5; }
  .node-pending { fill: #e5e7eb; stroke: #9ca3af; stroke-dasharray: 4 3; }
  .node-running { fill: #3b82f6; stroke: #2563eb; }
  .node-awaiting_integration { fill: #a78bfa; stroke: #7c3aed; }
  .node-integrating { fill: #f472b6; stroke: #db2777; }
  .node-done { fill: #16a34a; stroke: #15803d; }
  .node-aborted { fill: #dc2626; stroke: #991b1b; }
  .node-blocked { fill: #f59e0b; stroke: #b45309; }
  .node-glyph { fill: #ffffff; font-size: 16px; text-anchor: middle; dominant-baseline: central; }
  .node-label { font-size: 13px; text-anchor: middle; dominant-baseline: central; }
  .node-halo { fill: none; stroke: #2563eb; stroke-width: 3; stroke-dasharray: 3 3; }
  .edge { stroke: #6b7280; stroke-width: 1.5; }
  .legend { display: flex; gap: 16px; list-style: none; padding: 0; font-size: 13px; }
  .legend-swatch { display: inline-block; width: 12px; height: 12px; margin-right: 4px; border-radius: 50%; }
  .legend-swatch.node-pending { background: #e5e7eb; border: 1px dashed #9ca3af; }
  .legend-swatch.node-running { background: #3b82f6; }
  .legend-swatch.node-awaiting_integration { background: #a78bfa; }
  .legend-swatch.node-integrating { background: #f472b6; }
  .legend-swatch.node-done { background: #16a34a; }
  .legend-swatch.node-aborted { background: #dc2626; }
  .legend-swatch.node-blocked { background: #f59e0b; }
  .legend-halo-swatch { border: 2px dashed #2563eb; }
  @media (prefers-color-scheme: dark) {
    .graph-diagram { color: #e5e7eb; }
    .edge { stroke: #9ca3af; }
  }
</style>`;

/**
 * DAG を SVG として描画する props-only な component。API モック不要の
 * 純粋関数として実装する（design 指示「component は props-only」）。
 * 外部の描画ライブラリは使わず、素の SVG 文字列を組み立てる。
 */
function renderGraphDiagram(props: Readonly<GraphDiagramProps>): string {
  const { graph, nextNodeId } = props;
  if (graph.nodes.length === 0) {
    return renderEmptyState(graph);
  }

  const layouts = computeLayout(graph.nodes);
  const { width, height } = computeViewBox(layouts);

  return `<div class="graph-diagram">
    ${STYLE}
    <h1>${escapeHtml(graph.goal)}</h1>
    ${renderLegend()}
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="タスクグラフ">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280" />
        </marker>
      </defs>
      ${renderEdges(layouts)}
      ${layouts.map((layout) => renderNode(layout, nextNodeId)).join("\n")}
    </svg>
  </div>`;
}

export { renderGraphDiagram };
