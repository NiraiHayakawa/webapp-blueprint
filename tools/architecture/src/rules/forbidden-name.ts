import type { Violation } from "../violation.ts";
import path from "node:path";
import { walkFiles } from "../file-walk.ts";

const RULE_ID = "forbidden-name";

/** design §3「拡張はファイル/ディレクトリの追加で表現される」原則7の「吹き溜まり名」禁止リスト。 */
const FORBIDDEN_NAMES = new Set([
  "common",
  "shared",
  "utils",
  "helpers",
  "misc",
  "types",
  "models",
  "constants",
  "interfaces",
]);

function isForbidden(segment: string): boolean {
  return FORBIDDEN_NAMES.has(segment.toLowerCase());
}

/** 最後のセグメント（ファイル名）なら拡張子を除いた名前を、それ以外はそのまま返す。 */
function getNameToCheck(segment: string, isLastSegment: boolean): string {
  if (isLastSegment) {
    return segment.replace(/\.[^.]+$/u, "");
  }
  return segment;
}

/** ディレクトリ名の違反は、パス単位で 1 回だけ報告する（同じディレクトリを複数ファイルから辿るため）。 */
function recordDirectoryViolation(
  directoryPath: string,
  reportedDirectories: Set<string>,
): Violation | undefined {
  if (reportedDirectories.has(directoryPath)) {
    return undefined;
  }
  reportedDirectories.add(directoryPath);
  return {
    filePath: directoryPath,
    line: 1,
    ruleId: RULE_ID,
    hint: `ディレクトリ名 "${path.basename(directoryPath)}" は吹き溜まり名として禁止されている`,
  };
}

interface SegmentEvaluationContext {
  readonly segments: readonly string[];
  readonly filePath: string;
  readonly reportedDirectories: Set<string>;
}

/** パスの 1 セグメント（ファイル名 or ディレクトリ名）を検査する。 */
function evaluateSegment(context: SegmentEvaluationContext, index: number): Violation | undefined {
  const segment = context.segments[index];
  if (segment === undefined) {
    return undefined;
  }
  const isLastSegment = index === context.segments.length - 1;
  const nameToCheck = getNameToCheck(segment, isLastSegment);
  if (!isForbidden(nameToCheck)) {
    return undefined;
  }

  if (isLastSegment) {
    return {
      filePath: context.filePath,
      line: 1,
      ruleId: RULE_ID,
      hint: `ファイル名 "${nameToCheck}" は吹き溜まり名として禁止されている`,
    };
  }

  return recordDirectoryViolation(
    context.segments.slice(0, index + 1).join("/"),
    context.reportedDirectories,
  );
}

/** 1 ファイルのパスに含まれる全セグメントを検査する。 */
function collectViolationsForFile(filePath: string, reportedDirectories: Set<string>): Violation[] {
  const context: SegmentEvaluationContext = {
    segments: filePath.split("/"),
    filePath,
    reportedDirectories,
  };
  const violations: Violation[] = [];

  for (let index = 0; index < context.segments.length; index += 1) {
    const violation = evaluateSegment(context, index);
    if (violation === undefined) {
      continue;
    }
    violations.push(violation);
  }

  return violations;
}

/**
 * scanRoots 配下の全ファイル/ディレクトリ名（拡張子を除いた部分）を検査する。
 * ts-morph の Project ではなく fs を直接歩くのは、`.feature` など
 * ts-morph が読み込まないファイルのディレクトリ名も対象にするため。
 */
function check(scanRoots: readonly string[]): Violation[] {
  const violations: Violation[] = [];
  const reportedDirectories = new Set<string>();

  for (const scanRoot of scanRoots) {
    for (const filePath of walkFiles(scanRoot)) {
      violations.push(...collectViolationsForFile(filePath, reportedDirectories));
    }
  }

  return violations;
}

export { RULE_ID, check };
