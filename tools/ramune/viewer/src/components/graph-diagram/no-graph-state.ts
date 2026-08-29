/**
 * `.ramune/graph.json` 自体がまだ存在しない状態（ramune を一度も実行していない）
 * の表示。graph-diagram.ts の `renderEmptyState`（グラフは取得できたが
 * nodes が空）とは区別する: こちらは Graph を一切持たない props-less な
 * 状態であり、goal も表示できない（原則2 fail-fast: 「まだ無い」ことを
 * 隠さず正直に表示する。壊れたグラフとは違い、例外にはしない）。
 *
 * graph-diagram.ts と同じディレクトリに置きつつ別ファイルにしている理由:
 * graph-diagram.ts に追記すると eslint/max-lines（1ファイルあたりの許容行数。
 * 原則7「拡張はファイルの追加で表現される」）を超える。文言は固定文字列のみで
 * 動的な値を埋め込まないため、graph-diagram.ts の escapeHtml は不要。
 */
function renderNoGraphState(): string {
  return `<div class="graph-diagram graph-diagram-no-graph">
    <h1>グラフがまだありません</h1>
    <p>ramune をまだ実行していないため、グラフがまだありません。</p>
  </div>`;
}

export { renderNoGraphState };
