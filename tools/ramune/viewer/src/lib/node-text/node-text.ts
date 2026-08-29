import type {
  BoundaryResult,
  ReadOnlyResult,
  RepositoryResult,
} from "@webapp-blueprint/ramune-graph";

// ノードを描画するときのテキスト整形。components/graph-diagram（SVG のツール
// チップ）と components/node-list（一覧の本文）の両方が同じ整形を必要とする
// ため、どちらか一方に置いてもう一方が参照する形にせず、共通の所有レイヤを
// ここに置く（similarity-ts が検出する「偶然形が似ているだけの重複」ではなく、
// 「同じ知識の重複」であるため共通化する側の判断。design §5 の対応表1番目）。
//
// 取得口（lib/graph-source）と違い API 境界を持たない純粋なテキスト処理だが、
// components/ は props-only、features/ は API 境界を持つもの、という区分に
// どちらも当てはまらないため lib/ に置く。

/**
 * HTML の属性値・テキストとして安全に埋め込める形に変換する。
 * .ramune/graph.json の内容（goal / title / result / blockage の reason）は
 * 任意の文字列であり、そのまま innerHTML に流すと HTML として解釈される。
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** done ノードが持つ完了証跡。boundary と task で形が異なる。 */
type NodeResult = BoundaryResult | ReadOnlyResult | RepositoryResult;

/**
 * done ノードの `result`（完了証跡。NodeResult）を表示用の文字列にする。
 *
 * `indentSpaces` は `JSON.stringify` の第3引数にそのまま渡す。ツールチップは 0
 * （1行に詰める）、一覧の本文は 2（構造を読ませる）を渡す。
 */
function formatNodeResult(result: NodeResult, indentSpaces: number): string {
  return JSON.stringify(result, null, indentSpaces);
}

export { escapeHtml, formatNodeResult };
