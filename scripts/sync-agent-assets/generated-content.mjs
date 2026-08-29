// 生成物 (.agents/skills/**) の中身をどう組み立てるかだけを持つモジュール。
// ファイルシステムには触れない（file-tree.mjs が担当）。
// 概念単位の分割（design doc 原則7）: 「生成物の内容を決める」と
// 「ディレクトリを歩く」は別の関心事であり、同じファイルに置くと
// 前者を変えたいだけの変更が後者の再レビューを強制してしまう。

// frontmatter の閉じ区切り "---" の文字数。
const DASHES_LENGTH = 3;

// マーカー検出用の固定文字列。relPath 等の可変情報を含めない
// （ファイルごとにマーカー行の全文が変わっても「マーカーがあるかどうか」の
// 判定だけは変わらないようにするため）。
const MARKER_SENTINEL = "生成物 (scripts/sync-agent-assets.mjs)";

/** @param {string} relPath */
function markerLine(relPath) {
  return `<!-- ${MARKER_SENTINEL} -- 直接編集しないでください。正本: .claude/skills/${relPath} / 再生成: mise run sync:agents -->`;
}

/** @param {string} content */
function hasMarker(content) {
  return content.includes(MARKER_SENTINEL);
}

/** @param {string} content */
function hasFrontmatterOpening(content) {
  return content.startsWith("---\n") || content.startsWith("---\r\n");
}

/**
 * frontmatter の閉じ区切り（2 個目の `---` の開始位置）を探す。
 * 見つからない場合は、壊れた frontmatter を静かに無視するのではなく
 * 例外にする（fail-fast）。
 * @param {string} content
 */
function findClosingDashes(content) {
  const firstLineBreak = content.indexOf("\n");
  const searchFrom = firstLineBreak + 1;
  const closingDashesAt = content.indexOf("\n---", searchFrom);
  if (closingDashesAt === -1) {
    throw new Error(
      "frontmatter の閉じ区切り (---) が見つかりません。SKILL.md の frontmatter が壊れている可能性があります。",
    );
  }
  return closingDashesAt;
}

/**
 * 閉じ区切り行の直後（= frontmatter 本体の終わり）の位置を求める。
 * @param {string} content
 * @param {number} closingDashesAt
 */
function computeHeadEnd(content, closingDashesAt) {
  // '\n' の次、つまり '---' の先頭
  const dashesStart = closingDashesAt + 1;
  const afterDashes = dashesStart + DASHES_LENGTH;
  if (content.startsWith("\r\n", afterDashes)) {
    return afterDashes + 2;
  }
  if (content.startsWith("\n", afterDashes)) {
    return afterDashes + 1;
  }
  if (afterDashes === content.length) {
    return afterDashes;
  }
  throw new Error(
    "frontmatter の閉じ区切り行の形式が想定と異なります（'---' の直後に改行以外の文字があります）。",
  );
}

/**
 * YAML frontmatter（先頭が `---` の行から、次に単独で `---` だけの行が
 * 現れるまで）を検出する。無ければ undefined を返す。
 * @param {string} content
 * @returns {{ head: string; rest: string } | null}
 */
function splitFrontmatter(content) {
  if (!hasFrontmatterOpening(content)) {
    return null;
  }

  const closingDashesAt = findClosingDashes(content);
  const headEnd = computeHeadEnd(content, closingDashesAt);
  return { head: content.slice(0, headEnd), rest: content.slice(headEnd) };
}

/**
 * 実装メモ（推測ではなく明示した決定）:
 * マーカーは「ファイルの絶対先頭（byte 0）」ではなく、YAML frontmatter がある場合は
 * その閉じ区切り（2 個目の `---`）の直後に置く。SKILL.md の frontmatter を消費する側
 * （skill ローダ）は frontmatter が byte 0 から始まることを前提にすることが多く、
 * マーカーをその前に置くと生成物が frontmatter として読めなくなる。「生成物である
 * ことが本文の先頭で即座にわかる」という guard 1 の意図は、本文（frontmatter 以降）の
 * 先頭に置くことで満たされると判断した。
 * @param {string} relPath
 * @param {string} sourceContent
 */
function buildGeneratedContent(relPath, sourceContent) {
  const marker = markerLine(relPath);
  const frontmatter = splitFrontmatter(sourceContent);
  if (frontmatter === null) {
    return `${marker}\n\n${sourceContent}`;
  }
  // frontmatter.rest は閉じ区切りの直後の改行から始まる（=空行 1 つ分を既に含む）ため、
  // マーカーの後ろは改行 1 つだけ足せば空行 1 つの区切りになる。
  return `${frontmatter.head}${marker}\n${frontmatter.rest}`;
}

export { buildGeneratedContent, hasMarker };
