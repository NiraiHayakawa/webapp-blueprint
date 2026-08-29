import type { GraphNode, NodeStatus } from "../../lib/graph-source/graph-source.ts";
import { buildNodeFragment } from "../../lib/selected-node/selected-node.ts";
import { escapeHtml, formatNodeResult } from "../../lib/node-text/node-text.ts";

// features/graph-view の GraphSummary をそのまま型として受け取らない（component は
// features に依存しない。tools/architecture の layer-dependency ルール）。呼び出し側が
// 集計結果を分解して渡せば構造的型付けで足りる。
interface NodeListProps {
  readonly nodes: readonly GraphNode[];
  /** status ごとの件数。キーの順序をそのまま表示順として使う。 */
  readonly counts: Readonly<Record<NodeStatus, number>>;
  readonly runnablePendingIds: readonly string[];
  readonly nextNodeId: string | undefined;
  /** 詳細を開いているノードの id（URL のフラグメント由来。lib/selected-node 参照）。 */
  readonly selectedNodeId: string | undefined;
}

const RESULT_INDENT_SPACES = 2;

const STYLE = `<style>
  .node-list { font-family: system-ui, sans-serif; color: #1f2937; font-size: 13px; }
  .status-counts { display: flex; gap: 12px; list-style: none; padding: 0; }
  .status-count { border: 1px solid #d1d5db; border-radius: 4px; padding: 2px 8px; }
  .node-rows { list-style: none; padding: 0; }
  .node-row { border-top: 1px solid #e5e7eb; padding: 6px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  .row-status { font-variant-numeric: tabular-nums; min-width: 4.5em; color: #6b7280; }
  .row-runnability { font-size: 12px; border-radius: 4px; padding: 0 6px; }
  .node-row[data-runnable="true"] .row-runnability { background: #dbeafe; color: #1d4ed8; }
  .node-row[data-next="true"] .row-title { font-weight: 600; }
  .row-title { flex: 1 1 20em; }
  .row-detail-link { color: #2563eb; }
  .node-detail { display: none; flex-basis: 100%; }
  .node-detail[data-open="true"] { display: block; }
  .node-detail-deps { color: #6b7280; }
  .node-blocked-reason { color: #b45309; }
  .node-result-body { white-space: pre-wrap; overflow-x: auto; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px; max-height: 24em; }
  @media (prefers-color-scheme: dark) {
    .node-list { color: #e5e7eb; }
    .node-row { border-color: #374151; }
    .node-result-body { background: #111827; border-color: #374151; }
  }
</style>`;

function renderStatusCounts(counts: NodeListProps["counts"]): string {
  const items = Object.entries(counts)
    .map(
      ([status, count]) =>
        `<li class="status-count">${escapeHtml(status)} <span data-status-count="${escapeHtml(status)}">${String(count)}</span></li>`,
    )
    .join("");
  return `<ul class="status-counts">${items}</ul>`;
}

/**
 * pending の task に対してだけ「実行可能（全 deps が done）」と「依存待ち」を
 * 区別して見せる。boundary は claim されないためラベルの対象外。done / aborted /
 * blocked に実行可能性の区別は無いため、ラベル自体を出さない。
 */
function renderRunnabilityLabel(node: Readonly<GraphNode>, isRunnable: boolean): string {
  if (node.kind !== "task" || node.status !== "pending") {
    return "";
  }
  return `<span class="row-runnability">${isRunnable ? "実行可能" : "依存待ち"}</span>`;
}

function renderDeps(node: Readonly<GraphNode>): string {
  if (node.deps.length === 0) {
    return "";
  }
  return `<p class="node-detail-deps">deps: ${escapeHtml(node.deps.join(", "))}</p>`;
}

/** blocked ノードが持つ blockage（実行段階・統合段階の障害記録）の理由を表示する。 */
function renderBlockageReason(node: Readonly<GraphNode>): string {
  if (node.status !== "blocked") {
    return "";
  }
  return `<p class="node-blocked-reason">blocked: ${escapeHtml(node.blockage.reason)}</p>`;
}

function renderResultBody(node: Readonly<GraphNode>): string {
  if (node.status !== "done") {
    return "";
  }
  return `<pre class="node-result-body">${escapeHtml(formatNodeResult(node.result, RESULT_INDENT_SPACES))}</pre>`;
}

/**
 * 詳細（deps / blockage の理由 / result 本文）の開閉は、開いている対象の id を
 * props で受け取って `data-open` として描き込む形にする。DOM 側の状態や CSS の
 * `:target` に持たせられない理由は lib/selected-node/selected-node.ts 参照。
 */
function renderNodeDetail(node: Readonly<GraphNode>, isOpen: boolean): string {
  const body = `${renderDeps(node)}${renderBlockageReason(node)}${renderResultBody(node)}`;
  if (body.length === 0) {
    return "";
  }
  return `<div class="node-detail" data-open="${String(isOpen)}">${body}</div>`;
}

function renderDetailLink(node: Readonly<GraphNode>, hasDetail: boolean, isOpen: boolean): string {
  if (!hasDetail) {
    return "";
  }
  const href = isOpen ? "#" : escapeHtml(buildNodeFragment(node.id));
  return `<a class="row-detail-link" href="${href}">${isOpen ? "閉じる" : "詳細"}</a>`;
}

interface NodeRowState {
  readonly isRunnable: boolean;
  readonly isNext: boolean;
  readonly isOpen: boolean;
}

function renderNodeRow(node: Readonly<GraphNode>, state: Readonly<NodeRowState>): string {
  const detail = renderNodeDetail(node, state.isOpen);
  return `<li class="node-row" data-node-row="${escapeHtml(node.id)}" data-runnable="${String(state.isRunnable)}" data-status="${node.status}" data-next="${String(state.isNext)}">
    <span class="row-status">${node.status}</span>
    ${renderRunnabilityLabel(node, state.isRunnable)}
    <span class="row-title">${escapeHtml(node.title)}</span>
    ${renderDetailLink(node, detail.length > 0, state.isOpen)}
    ${detail}
  </li>`;
}

/**
 * ノードを status 込みで一覧する props-only な component。
 *
 * SVG の図（components/graph-diagram）は形と位置で全体を見せるが、「残りが何件か」
 * 「どの pending が依存待ちで止まっているか」「Worker が何を返したか」は図から
 * 読めない。この一覧がその3つを担う。
 */
function renderNodeList(props: Readonly<NodeListProps>): string {
  const runnableIds = new Set(props.runnablePendingIds);
  const rows = props.nodes
    .map((node) =>
      renderNodeRow(node, {
        isRunnable: runnableIds.has(node.id),
        isNext: node.id === props.nextNodeId,
        isOpen: node.id === props.selectedNodeId,
      }),
    )
    .join("\n");

  return `<section class="node-list">
    ${STYLE}
    ${renderStatusCounts(props.counts)}
    <ol class="node-rows">${rows}</ol>
  </section>`;
}

export { renderNodeList };
