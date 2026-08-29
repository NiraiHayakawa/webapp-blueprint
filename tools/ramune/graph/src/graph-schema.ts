// .ramune/graph.json の実行時契約（スキーマ）。ファイルとして受け取った JSON を
// `GraphV2` に変換する唯一の入口であり、グラフ全体の形を検証する。
// すべての呼び出し元（mcp-server の GraphStore、`mise run ramune:status`）がここを通る。
//
// なぜ 1 箇所に集約するか: スキーマと graph.ts / nodes.ts の型が乖離した瞬間に
// `parseGraph` の戻り値型検査が落ちる。実行時契約と静的型の一致は機械で縛られる
// （docs/principles/enforce-with-machines.md）。
//
// すべての object と union branch は strict である（nodes.ts / brand.ts の
// strictObject）。未知キーは保持も strip もせずエラーになる。v1 の looseObject
// 方針（未知フィールドを通す）は「禁止フィールドをスキーマで拒否する」契約と
// 両立しないため引き継がない。
//
// version !== 2 のグラフは z.literal(2) の段階で拒否される。v1 グラフの読み替え・
// migration は存在しない（絶対規約 3。v1 ファイルの退避は WP2 の store が
// raw ファイルとして行う）。
//
// このモジュールは zod を import する = node_modules の解決を必要とする。
// PreToolUse hook（tools/ramune/hooks/src/）は node_modules が無い worktree でも
// 発火しうるため、hook が到達する経路（persisted-graph.ts）からは
// このモジュールを参照しない（ADR 0004「ハーネスの起動経路」）。
import type { GraphV2 } from "./graph.ts";
import { graphV2Schema } from "./graph.ts";

/**
 * `.ramune/graph.json` の生テキストを `GraphV2` に変換する。
 *
 * 引数が解析済みの値ではなく生の JSON 文字列なのは、ここが I/O 境界そのもの
 * だからである。「読んだ側が JSON.parse して、その結果を検証関数に渡す」形に
 * すると、検証前の値が呼び出し元の変数として一度姿を現し、検証を飛ばした
 * 使い方が書けてしまう。文字列を受け取って `GraphV2` を返す形にすることで、
 * 未検証の値が境界の外に漏れない。
 *
 * 形が契約を満たさない場合は zod の `ZodError`、JSON として壊れている場合は
 * `SyntaxError` を投げる（どちらも握りつぶさない。
 * docs/principles/fail-fast.md）。version が 2 以外のファイルもここで拒否され、
 * 変更操作が走る前に落ちる。
 */
export function parseGraph(rawJson: string): GraphV2 {
  const parsed: unknown = JSON.parse(rawJson);
  return graphV2Schema.parse(parsed);
}
