/**
 * Markdown テキスト(AGENTS.md / docs/recipes/ 等)から、policy-as-test が
 * 必要とする最小限の情報だけを取り出す。フルの Markdown パーサではなく、
 * 見出し(`#`...)とインラインコード(`` `...` ``)という 2 つの構文要素だけを
 * 対象にする。
 */

interface HeadingSection {
  readonly level: number;
  readonly title: string;
  /** その見出しの本文(次の同level以下の見出しの直前まで。見出し行自体は含まない)。 */
  readonly body: string;
}

interface HeadingLine {
  readonly level: number;
  readonly title: string;
  readonly lineIndex: number;
}

/** 各行を見出し行(`#` の連続数 + タイトル)として抜き出す。見出しでない行は無視する。 */
function scanHeadingLines(lines: readonly string[]): HeadingLine[] {
  const headings: HeadingLine[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = /^(?<hashes>#{1,6})\s+(?<title>.+)$/u.exec(lines[lineIndex] ?? "");
    if (!match) {
      continue;
    }
    headings.push({
      level: (match[1] ?? "").length,
      title: (match[2] ?? "").trim(),
      lineIndex,
    });
  }
  return headings;
}

/**
 * headings[headingIndex] の本文が終わる行を探す。
 * 同レベル以下(数値が小さいか等しい)の次の見出しの直前まで、が本文の終端になる。
 */
function findSectionEndLineIndex(
  headings: readonly HeadingLine[],
  headingIndex: number,
  totalLineCount: number,
): number {
  const current = headings[headingIndex];
  if (!current) {
    return totalLineCount;
  }
  for (let laterIndex = headingIndex + 1; laterIndex < headings.length; laterIndex += 1) {
    const candidate = headings[laterIndex];
    if (candidate && candidate.level <= current.level) {
      return candidate.lineIndex;
    }
  }
  return totalLineCount;
}

/** `#` の連続数を見出しレベルとして、見出しごとにセクションへ分割する。 */
function splitIntoSections(markdownText: string): HeadingSection[] {
  const lines = markdownText.split("\n");
  const headings = scanHeadingLines(lines);

  const sections: HeadingSection[] = [];
  for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
    const current = headings[headingIndex];
    if (!current) {
      continue;
    }
    const endLineIndex = findSectionEndLineIndex(headings, headingIndex, lines.length);
    sections.push({
      level: current.level,
      title: current.title,
      body: lines.slice(current.lineIndex + 1, endLineIndex).join("\n"),
    });
  }

  return sections;
}

/** 見出しタイトルが pattern に一致するセクションをすべて返す。 */
function findSectionsByTitle(markdownText: string, pattern: RegExp): HeadingSection[] {
  return splitIntoSections(markdownText).filter((section) => pattern.test(section.title));
}

/**
 * `` `token` `` 形式のインラインコードのうち、日本語の説明文ではなく
 * 「固有の値(コマンド・ファイル名・マーカー文字列等)」を指していそうな
 * ものだけを返す(ASCII の記号・英数字のみで構成されるトークン)。
 */
function isLiteralToken(token: string): boolean {
  if (token.trim() === "") {
    return false;
  }
  // 日本語(ひらがな・カタカナ・漢字)を含むものは説明文であり、固有の値ではない。
  if (/[぀-ヿ㐀-鿿]/u.test(token)) {
    return false;
  }
  return /^[ -~]+$/u.test(token);
}

function extractLiteralInlineCodeSpans(text: string): string[] {
  const spans: string[] = [];
  const pattern = /`(?<token>[^`\n]+)`/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const token = match[1] ?? "";
    if (isLiteralToken(token)) {
      spans.push(token);
    }
  }
  return spans;
}

export { splitIntoSections, findSectionsByTitle, extractLiteralInlineCodeSpans };
export type { HeadingSection };
