/**
 * mise.toml の `[tasks.<name>]` セクションから `depends` 配列の要素を取り出す。
 * 汎用 TOML パーサは新規依存として追加できる立場にない（tests/policy は
 * pnpm workspace パッケージではない）ため、このリポジトリの mise.toml が
 * 実際に使っている形（セクション直下に複数行のブロック配列
 * `depends = [ ... ]`、またはインラインのフローリスト `depends = [a, b]`）
 * だけを前提にした行ベースの走査で必要な情報だけを取り出す。汎用性は捨てる。
 *
 * タスク名は `[tasks.check]`（裸）と `[tasks."mcp:ramune"]`（引用符付き。`:` を
 * 含む名前は TOML のベアキーにできない）の両方の書き方がある。呼び出し元は
 * 引用符の有無を意識せず `"check"` / `"mcp:ramune"` を渡す。
 */
import { stripQuotes } from "../yaml-primitives/yaml-primitives.ts";

const SECTION_HEADER = /^\[(?<name>[^\]]+)\]$/u;
const DEPENDS_KEY = /^depends\s*=\s*(?<value>.*)$/u;
const TASK_SECTION_PREFIX = "tasks.";

interface SectionRange {
  readonly start: number;
  readonly end: number;
}

/** セクション見出しの名前（`tasks."mcp:ramune"` 等）が、指定のタスクを指しているか。 */
function matchesTaskSection(headerName: string, taskName: string): boolean {
  if (!headerName.startsWith(TASK_SECTION_PREFIX)) {
    return false;
  }
  return stripQuotes(headerName.slice(TASK_SECTION_PREFIX.length)) === taskName;
}

/** `[tasks.<taskName>]` セクションの本文範囲（次のセクション見出し、または末尾まで）。無ければ undefined。 */
function findTaskSectionRange(
  lines: readonly string[],
  taskName: string,
): SectionRange | undefined {
  const startIndex = lines.findIndex((line) => {
    const headerName = SECTION_HEADER.exec(line.trim())?.groups?.name;
    return headerName !== undefined && matchesTaskSection(headerName, taskName);
  });
  if (startIndex === -1) {
    return undefined;
  }

  for (let lineIndex = startIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    if (SECTION_HEADER.test(lines[lineIndex]?.trim() ?? "")) {
      return { start: startIndex + 1, end: lineIndex };
    }
  }
  return { start: startIndex + 1, end: lines.length };
}

/** インラインのフローリスト `[a, b]`（角括弧の中身）を要素に分解する。 */
function parseInlineArrayInner(inner: string): string[] {
  return inner
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .map((item) => stripQuotes(item));
}

/** 複数行のブロック配列（`depends = [` の次行から `]` まで、各行が `"item",` の形）を取り出す。 */
function collectMultilineArrayItems(
  lines: readonly string[],
  startIndex: number,
  endIndex: number,
): string[] {
  const items: string[] = [];
  for (let lineIndex = startIndex; lineIndex < endIndex; lineIndex += 1) {
    const line = lines[lineIndex]?.trim() ?? "";
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("]")) {
      break;
    }
    items.push(stripQuotes(line.replace(/,$/u, "")));
  }
  return items;
}

/** `section` の範囲内から `depends = ...` 行の index を探す。無ければ undefined。 */
function findDependsLineIndex(lines: readonly string[], section: SectionRange): number | undefined {
  for (let lineIndex = section.start; lineIndex < section.end; lineIndex += 1) {
    if (DEPENDS_KEY.test(lines[lineIndex]?.trim() ?? "")) {
      return lineIndex;
    }
  }
  return undefined;
}

/** `depends = ...` 行(インライン値かブロック配列の先頭)から要素を取り出す。 */
function resolveDependsValueAt(
  lines: readonly string[],
  lineIndex: number,
  sectionEnd: number,
): string[] {
  const match = DEPENDS_KEY.exec(lines[lineIndex]?.trim() ?? "");
  const inlineValue = (match?.groups?.value ?? "").trim();
  if (inlineValue.startsWith("[") && inlineValue.endsWith("]")) {
    return parseInlineArrayInner(inlineValue.slice(1, -1));
  }
  if (inlineValue === "[") {
    return collectMultilineArrayItems(lines, lineIndex + 1, sectionEnd);
  }
  return [];
}

/** `[tasks.<taskName>]` の `depends` 配列の要素（タスク名の一覧）を取り出す。セクションが無ければ空配列。 */
function extractTaskDepends(tomlText: string, taskName: string): string[] {
  const lines = tomlText.split("\n");
  const section = findTaskSectionRange(lines, taskName);
  if (!section) {
    return [];
  }
  const dependsLineIndex = findDependsLineIndex(lines, section);
  if (dependsLineIndex === undefined) {
    return [];
  }
  return resolveDependsValueAt(lines, dependsLineIndex, section.end);
}

export { extractTaskDepends };
