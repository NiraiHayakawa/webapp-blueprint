/**
 * 違反 1 件を表す型と、報告フォーマット。
 *
 * フォーマットは `ファイル:行 ルールID ヒント` に固定する。
 */
export interface Violation {
  readonly filePath: string;
  readonly line: number;
  readonly ruleId: string;
  readonly hint: string;
}

export function formatViolation(violation: Violation): string {
  return `${violation.filePath}:${violation.line} ${violation.ruleId} ${violation.hint}`;
}
