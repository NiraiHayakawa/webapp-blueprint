/**
 * pnpm-lock.yaml から `specifier:` の値だけを、そのキー経路
 * （例: `importers.apps/api.devDependencies.typescript`）付きで取り出す。
 *
 * pnpm-lock.yaml は `catalogs.default.<name>.{specifier,version}` と
 * `importers.<pkgPath>.[dependencies|devDependencies].<name>.{specifier,version}`
 * という、配列を含まないマッピングのみの構造をしている（このリポジトリの
 * 実物で確認済み）。汎用 YAML パーサではなく、マッピングのキー経路を
 * インデントで追うだけの薄い walker で足りる。
 */
import { indentOf, stripQuotes } from "../yaml-primitives/yaml-primitives.ts";

interface LockfileSpecifier {
  /** 例: ["importers", "apps/api", "devDependencies", "typescript"] */
  readonly path: readonly string[];
  readonly specifier: string;
  readonly line: number;
}

interface StackEntry {
  readonly indent: number;
  readonly key: string;
}

interface ParsedLine {
  readonly indent: number;
  readonly key: string;
  readonly rawValue: string;
}

const KEY_VALUE_LINE = /^(?<indent>\s*)(?<key>[A-Za-z0-9_.@/-]+|"[^"]*"|'[^']*'):\s*(?<value>.*)$/u;

/** 1 行から `<indent><key>: <value>` を取り出す。マッチしなければ undefined。 */
function parseKeyValueLine(line: string): ParsedLine | undefined {
  const match = KEY_VALUE_LINE.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    indent: indentOf(line),
    key: stripQuotes(match.groups?.key ?? ""),
    rawValue: (match.groups?.value ?? "").trim(),
  };
}

/** インデントが currentIndent 以上のスタック要素を取り除く(親キー経路の巻き戻し)。 */
function popToIndent(stack: StackEntry[], currentIndent: number): void {
  while (stack.length > 0 && (stack.at(-1)?.indent ?? -1) >= currentIndent) {
    stack.pop();
  }
}

interface LockfileScanState {
  readonly stack: StackEntry[];
  readonly specifiers: LockfileSpecifier[];
}

/** 1 行を解釈し、`specifier:` であれば `state.specifiers` に、経路(スタック)を更新する。 */
function processLockfileLine(state: LockfileScanState, line: string, lineNumber: number): void {
  const parsed = parseKeyValueLine(line);
  if (!parsed) {
    return;
  }

  popToIndent(state.stack, parsed.indent);

  if (parsed.key === "specifier" && parsed.rawValue !== "") {
    state.specifiers.push({
      path: state.stack.map((entry) => entry.key),
      specifier: stripQuotes(parsed.rawValue),
      line: lineNumber,
    });
  }

  state.stack.push({ indent: parsed.indent, key: parsed.key });
}

function extractLockfileSpecifiers(lockfileText: string): LockfileSpecifier[] {
  const lines = lockfileText.split("\n");
  const state: LockfileScanState = { stack: [], specifiers: [] };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }
    processLockfileLine(state, line, lineIndex + 1);
  }

  return state.specifiers;
}

export { extractLockfileSpecifiers };
export type { LockfileSpecifier };
