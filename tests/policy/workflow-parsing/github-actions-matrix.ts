/**
 * GitHub Actions workflow のジョブ本文から `strategy.matrix.task` の一覧を
 * 取り出す薄いパーサ。ジョブ一覧・needs・env・image の抽出は
 * github-actions-workflow.ts が持つ(このファイルは matrix.task 専用に
 * 分離する。1 ファイルの行数上限(§7 相当の codopsy max-lines)を超えない
 * ようにする分割でもある)。
 */
import {
  collectBlockListItems,
  findBlockEnd,
  indentOf,
  parseInlineListValue,
} from "../yaml-primitives/yaml-primitives.ts";

const MATRIX_LINE = /^\s*matrix:\s*$/u;
const TASK_KEY_LINE = /^\s*task:\s*(?<value>.*)$/u;

/** `matrixLineIndex` 直下(インデントが浅くなるまで)から `task:` 行の index を探す。無ければ undefined。 */
function findTaskLineIndex(lines: readonly string[], matrixLineIndex: number): number | undefined {
  const matrixIndent = indentOf(lines[matrixLineIndex] ?? "");
  const blockEnd = findBlockEnd(lines, matrixLineIndex + 1, matrixIndent + 1);
  for (let lineIndex = matrixLineIndex + 1; lineIndex < blockEnd; lineIndex += 1) {
    if (TASK_KEY_LINE.test(lines[lineIndex] ?? "")) {
      return lineIndex;
    }
  }
  return undefined;
}

/** `task:` 行(インライン値かブロックリストの先頭)から値を取り出す。 */
function resolveTaskListAt(lines: readonly string[], taskLineIndex: number): string[] {
  const line = lines[taskLineIndex] ?? "";
  const inlineValue = (TASK_KEY_LINE.exec(line)?.groups?.value ?? "").trim();
  const inlineTasks = parseInlineListValue(inlineValue);
  if (inlineTasks !== undefined) {
    return inlineTasks;
  }
  return collectBlockListItems(lines, taskLineIndex + 1, indentOf(line));
}

/** ジョブ本文から `strategy.matrix.task` の値を取り出す。`matrix:` が無い、または直下に `task:` が無ければ空配列。 */
function extractMatrixTaskList(jobBody: string): string[] {
  const lines = jobBody.split("\n");
  const matrixLineIndex = lines.findIndex((line) => MATRIX_LINE.test(line));
  if (matrixLineIndex === -1) {
    return [];
  }
  const taskLineIndex = findTaskLineIndex(lines, matrixLineIndex);
  if (taskLineIndex === undefined) {
    return [];
  }
  return resolveTaskListAt(lines, taskLineIndex);
}

export { extractMatrixTaskList };
