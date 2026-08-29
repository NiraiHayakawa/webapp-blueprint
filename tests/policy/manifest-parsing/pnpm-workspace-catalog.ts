/**
 * pnpm-workspace.yaml の `catalog:` ブロック（フラットな
 * `<name>: <version>` マッピング。ネストしない）から specifier を取り出す。
 * one-version rule（design §3）の一次情報源。
 */
import { indentOf, stripQuotes } from "../yaml-primitives/yaml-primitives.ts";

interface CatalogSpecifier {
  readonly name: string;
  readonly specifier: string;
  readonly line: number;
}

const CATALOG_ENTRY_LINE = /^\s*(?<name>[A-Za-z0-9_.@/-]+|"[^"]*"|'[^']*'):\s*(?<value>.+)$/u;

/**
 * `<name>: <specifier>` の 1 行を取り出す。マッチしなければ undefined。
 * `line` 抜きの `CatalogSpecifier` を返す（呼び出し側が行番号を付与する）。
 * 独自の型を新設せず `Pick` で投影するのは、similarity-ts が
 * `{ name; specifier }` という同型の別 interface（NamedSpecifier,
 * tests/policy/dependency-pin/dependency-pin.check.ts）を検出したため
 * （design doc §5「similarity-ts」: 検出は「所有レイヤが間違っているサイン」
 * を疑うトリガー）。ここでの重複は「本当は同じ知識が2箇所にある」パターン
 * だった — 実体は既存の `CatalogSpecifier` の部分集合そのものであり、
 * 別名の interface を新設する必要が無かった。
 */
function parseCatalogEntryLine(
  line: string,
): Pick<CatalogSpecifier, "name" | "specifier"> | undefined {
  const match = CATALOG_ENTRY_LINE.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    name: stripQuotes(match.groups?.name ?? ""),
    specifier: stripQuotes((match.groups?.value ?? "").split(" #")[0] ?? ""),
  };
}

/** `startIndex` から見て、最初の非空・非コメント行のインデントを返す。無ければ -1。 */
function findFirstEntryIndent(lines: readonly string[], startIndex: number): number {
  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }
    return indentOf(line);
  }
  return -1;
}

/** `entryIndent` 未満のインデントに戻る最初の非空行の index を返す(見つからなければ末尾)。 */
function findCatalogBlockEnd(
  lines: readonly string[],
  startIndex: number,
  entryIndent: number,
): number {
  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }
    if (indentOf(line) < entryIndent) {
      return lineIndex;
    }
  }
  return lines.length;
}

interface CatalogBlockRange {
  readonly start: number;
  readonly end: number;
  readonly entryIndent: number;
}

/** `range` で示される行範囲から、`entryIndent` と同じ深さのエントリだけを集める。 */
function collectCatalogEntries(
  lines: readonly string[],
  range: CatalogBlockRange,
): CatalogSpecifier[] {
  const specifiers: CatalogSpecifier[] = [];
  for (let lineIndex = range.start; lineIndex < range.end; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#") || indentOf(line) !== range.entryIndent) {
      continue;
    }
    const parsed = parseCatalogEntryLine(line);
    if (!parsed) {
      continue;
    }
    specifiers.push({ ...parsed, line: lineIndex + 1 });
  }
  return specifiers;
}

function extractCatalogSpecifiers(workspaceYamlText: string): CatalogSpecifier[] {
  const lines = workspaceYamlText.split("\n");
  const catalogLineIndex = lines.findIndex((line) => /^catalog:\s*$/u.test(line));
  if (catalogLineIndex === -1) {
    return [];
  }

  const entryIndent = findFirstEntryIndent(lines, catalogLineIndex + 1);
  if (entryIndent === -1) {
    return [];
  }

  const start = catalogLineIndex + 1;
  const end = findCatalogBlockEnd(lines, start, entryIndent);
  return collectCatalogEntries(lines, { start, end, entryIndent });
}

export { extractCatalogSpecifiers };
export type { CatalogSpecifier };
