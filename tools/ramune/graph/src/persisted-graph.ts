// .ramune/graph.json というファイルとしての永続化に関する、**依存を一切持たない**
// 知識だけを置く: 「リポジトリルートからの相対パスの規約」と「session.active の
// 読み取り」の2つ。
//
// この2つをここに置く理由: どちらも「グラフをファイルとして読み書きする」複数の
// 呼び出し元(`tools/ramune/mcp-server` の GraphStore、`tools/ramune/hooks` の
// PreToolUse hook、`mise run ramune:status`)が共通して必要とする一方、それぞれの
// 呼び出し元は目的の異なる別プロセス・別パッケージであり、どちらか一方に
// 実装を置いてもう一方がそれに依存する形にはできない(hooks は MCP SDK 等の
// 重い依存を持つ mcp-server に依存したくない)。「.ramune/graph.json という配置
// 規約」と「稼働しているかどうかの読み取り方」を各呼び出し元がそれぞれ独自に
// 再実装すると、変更したときに一方だけ更新し忘れる drift が起きる
// (docs/principles/one-command-verification.md と同じ「二重管理を避ける」動機)。
//
// 【このファイルが依存を持てない理由】PreToolUse hook はこのファイルを相対パスで
// 直接 import する(`tools/ramune/hooks/src/mode.ts`)。hook は node_modules がまだ
// 無い worktree の最初のツール呼び出しでも発火するため、ここに bare specifier の
// import(zod を含む)が1つでも入ると import 時にプロセスが落ち、Claude Code が
// それを non-blocking error として素通りさせる = ramune の fail-closed 強制が
// すり抜ける(ADR 0004。2026-08-10 に実際に起きた事故)。
// **このファイルとその import 先には、node:組み込みも含めて依存を足さないこと。**
// グラフ全体のスキーマ検証(zod)が要る呼び出し元は `graph-schema.ts` の
// `parseGraph` を使う。そちらは hook が到達しない経路に置いてある。

/** .ramune/graph.json のリポジトリルートからの相対パス。配置規約はこの1箇所だけで持つ。 */
export const GRAPH_FILE_RELATIVE_PATH = ".ramune/graph.json";

/**
 * `session.state === "active"` の 1 ビットだけを読む（ADR 0005）。
 *
 * hook（`tools/ramune/hooks/src/mode.ts`）が必要とするのはこの 1 ビットだけであり、
 * グラフ全体の形の検証は実際にグラフを操作する側（`GraphStore`）の責務である。
 * hook にグラフ全体のスキーマを通させると、モード判定に無関係なフィールドの追加
 * が worktree 全体のツール拒否に化ける — 2026-08-10 に実際に起きた。各消費者が
 * 自分が依存する不変条件だけを見る形にする。v2 では session は
 * `{ state: "inactive" } | { state: "active", runId, epoch }` という union であり、
 * 稼働判定は `state` フィールドの値で行う（v1 の `session.active: boolean`
 * という形は存在しない。v2 スキーマは unknown key を拒否するため、旧形の
 * グラフはそもそも parse を通らない）。
 *
 * 引数が解析済みの値ではなく生の JSON 文字列なのは、`parseGraph` と同じ理由で
 * ここが I/O 境界そのものだからである（未検証の値を境界の外に出さない）。
 * JSON として壊れている場合は `SyntaxError` がそのまま伝播する。形が読めない
 * 場合は `undefined` を返す。呼び出し元は「非稼働」に丸めず、判定不能として
 * 扱う（docs/principles/fail-fast.md）。
 *
 * 型の絞り込みに `typeof` ではなく `instanceof Object` と文字列リテラルとの比較を
 * 使っているのは、`.ramune/graph.json` を読む唯一の経路が `JSON.parse` の出力
 * （同一 realm の値のみ）であり、この文脈では「オブジェクトか」「文字列か」を
 * これで過不足なく決められるためである。zod で書けない事情は冒頭を参照。
 */
export function readSessionActive(rawJson: string): boolean | undefined {
  const root: unknown = JSON.parse(rawJson);
  const session =
    root instanceof Object && "session" in root && root.session instanceof Object
      ? root.session
      : undefined;
  if (session === undefined || !("state" in session)) {
    return undefined;
  }
  const { state } = session;
  if (state === "active") {
    return true;
  }
  return state === "inactive" ? false : undefined;
}
