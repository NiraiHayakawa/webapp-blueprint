/**
 * YAML テキストを行ベースで読むときに繰り返し必要になる、ごく低レベルの
 * 操作（インデント幅の計測・クォートの除去・インライン/ブロックリストの
 * 解釈）だけを持つモジュール。
 *
 * workflow-parsing（GitHub Actions workflow 用）と manifest-parsing
 * （pnpm-lock.yaml 用）の両方がこれを使う。similarity-ts の重複検出
 * （§5「検出系ツールの運用方針」）に引っかかった実体を、"utils" のような
 * 吹き溜まりではなく責務名詞（YAML の一次操作）で 1 箇所に切り出したもの。
 * リスト解釈の 2 関数（`parseInlineListValue` / `collectBlockListItems`）は、
 * workflow-parsing 内で `needs:` 用と matrix の `task:` 用に同じ形の走査が
 * 2 箇所現れたのを機に、ここへ一本化した（同じ similarity-ts の狙いの再適用）。
 */

/** 行頭から続く半角スペースの数（タブは前提にしない）。 */
function indentOf(line: string): number {
  const match = /^[ ]*/u.exec(line);
  if (!match) {
    return 0;
  }
  return match[0].length;
}

/** `indent` 未満のインデントに戻る最初の非空行の index を返す(見つからなければ末尾)。 */
function findBlockEnd(lines: readonly string[], startIndex: number, indent: number): number {
  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim() === "") {
      continue;
    }
    if (indentOf(line) < indent) {
      return lineIndex;
    }
  }
  return lines.length;
}

/** 前後の `"..."` / `'...'` を 1 段だけ剥がす。クォートが無ければそのまま返す。 */
function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const [first] = trimmed;
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * `key:` の後に続くインラインの値（フローリスト `[a, b]` またはスカラー）を
 * リストとして解釈する。値が空文字（何も書かれていない）なら undefined を
 * 返す — これは「インラインではなく次行以降のブロックリストを見に行け」
 * という呼び出し側への合図になる。
 */
function parseInlineListValue(value: string): string[] | undefined {
  if (value === "") {
    return undefined;
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    if (inner.trim() === "") {
      return [];
    }
    return inner.split(",").map((item) => stripQuotes(item));
  }
  return [stripQuotes(value)];
}

/** ブロックリストの 1 行(`  - foo`)から item 値を取り出す。マッチしなければ undefined。 */
function tryParseBlockListItem(line: string): string | undefined {
  const itemMatch = /^\s*-\s*(?<item>.+)$/u.exec(line);
  if (!itemMatch) {
    return undefined;
  }
  return stripQuotes(itemMatch.groups?.item ?? "");
}

/** ブロックリストの走査終了を表す一意な sentinel(item の値と衝突しない)。 */
const BLOCK_LIST_STOP = Symbol("block-list-stop");
type BlockListLineResult = string | typeof BLOCK_LIST_STOP | undefined;

/** ブロックリストの 1 行を判定する。空行は undefined(読み飛ばし)、終了は BLOCK_LIST_STOP、item ならその値。 */
function classifyBlockListLine(line: string, indent: number): BlockListLineResult {
  if (line.trim() === "") {
    return undefined;
  }
  if (indentOf(line) <= indent) {
    return BLOCK_LIST_STOP;
  }
  const item = tryParseBlockListItem(line);
  if (item === undefined) {
    return BLOCK_LIST_STOP;
  }
  return item;
}

/**
 * `startIndex` から、インデントが `indent` 以下に戻る（またはブロック
 * リストの item 行ではなくなる）まで `- item` 形式の要素を集める。
 */
function collectBlockListItems(
  lines: readonly string[],
  startIndex: number,
  indent: number,
): string[] {
  const items: string[] = [];
  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const result = classifyBlockListLine(lines[lineIndex] ?? "", indent);
    if (result === undefined) {
      continue;
    }
    if (result === BLOCK_LIST_STOP) {
      break;
    }
    items.push(result);
  }
  return items;
}

export { indentOf, stripQuotes, findBlockEnd, parseInlineListValue, collectBlockListItems };
