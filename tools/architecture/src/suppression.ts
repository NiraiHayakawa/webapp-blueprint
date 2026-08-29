import type { Violation } from "./violation.ts";

/**
 * 抑制コメントの規約（原則4「抑制には理由を書く」の機械強制）。
 *
 * - 行単位: `// architecture-check-disable-line <ruleId>: <理由>`
 *   そのコメントの次の行で発生した該当ルールの違反を抑制する。
 * - ファイル単位: `// architecture-check-disable-file <ruleId>: <理由>`
 *   ファイル内のどこで発生した該当ルールの違反も抑制する。
 *
 * 理由（`: ` 以降）が無い抑制コメントは、抑制自体を無効化した上で
 * `suppression-without-reason` という別の違反として報告する
 * （「理由の無い抑制を検出して落とす」の実装）。
 */
const DIRECTIVE_PATTERN =
  /architecture-check-disable-(?<scope>line|file)\s+(?<ruleId>[a-z0-9-]+)(?::\s*(?<reason>.+))?/u;

interface SuppressionDirective {
  readonly ruleId: string;
  readonly reason: string | undefined;
  readonly line: number;
  readonly scope: "line" | "file";
}

function normalizeReason(rawReason: string | undefined): string | undefined {
  const trimmedReason = rawReason?.trim();
  if (trimmedReason === undefined || trimmedReason.length === 0) {
    return undefined;
  }
  return trimmedReason;
}

function normalizeScope(rawScope: string): "line" | "file" {
  if (rawScope === "file") {
    return "file";
  }
  return "line";
}

function parseDirectives(fileText: string): SuppressionDirective[] {
  return fileText
    .split("\n")
    .map((lineText, index): SuppressionDirective | undefined => {
      const match = DIRECTIVE_PATTERN.exec(lineText);
      const groups = match?.groups;
      if (groups === undefined) {
        return undefined;
      }
      const { scope, ruleId, reason } = groups;
      if (ruleId === undefined || scope === undefined) {
        return undefined;
      }
      return {
        ruleId,
        reason: normalizeReason(reason),
        line: index + 1,
        scope: normalizeScope(scope),
      };
    })
    .filter((directive): directive is SuppressionDirective => directive !== undefined);
}

/**
 * ファイルごとの抑制コメント一覧を取得する。同一ファイルに対しては
 * `readFile` / `parseDirectives` を 1 回だけ実行し、結果を `directivesByFile`
 * に memoize する。
 */
function getDirectivesForFile(
  filePath: string,
  readFile: (filePath: string) => string,
  directivesByFile: Map<string, SuppressionDirective[]>,
): SuppressionDirective[] {
  const cached = directivesByFile.get(filePath);
  if (cached !== undefined) {
    return cached;
  }
  const directives = parseDirectives(readFile(filePath));
  directivesByFile.set(filePath, directives);
  return directives;
}

function findMatchingDirective(
  directives: readonly SuppressionDirective[],
  violation: Violation,
): SuppressionDirective | undefined {
  return directives.find((directive) => {
    if (directive.ruleId !== violation.ruleId) {
      return false;
    }
    return directive.scope === "file" || directive.line + 1 === violation.line;
  });
}

function buildUnreasonedSuppressionViolation(
  violation: Violation,
  matchingDirective: SuppressionDirective,
): Violation {
  return {
    filePath: violation.filePath,
    line: matchingDirective.line,
    ruleId: "suppression-without-reason",
    hint: `"${violation.ruleId}" の抑制コメントに理由が書かれていない。": <理由>" を付けること`,
  };
}

/** 1 件の違反が抑制処理でどう扱われたか（抑制されなかった/成立した/理由なしで成立した）。 */
type SuppressionOutcome =
  | { readonly kind: "remaining" }
  | { readonly kind: "suppressed" }
  | { readonly kind: "unreasoned"; readonly violation: Violation };

function resolveSuppressionOutcome(
  violation: Violation,
  directives: readonly SuppressionDirective[],
): SuppressionOutcome {
  const matchingDirective = findMatchingDirective(directives, violation);
  if (!matchingDirective) {
    return { kind: "remaining" };
  }
  if (matchingDirective.reason === undefined) {
    return {
      kind: "unreasoned",
      violation: buildUnreasonedSuppressionViolation(violation, matchingDirective),
    };
  }
  // reason があれば、その違反は握りつぶす（抑制成立）。
  return { kind: "suppressed" };
}

function appendSuppressionOutcome(
  outcome: SuppressionOutcome,
  violation: Violation,
  result: SuppressionResult,
): void {
  if (outcome.kind === "remaining") {
    result.remaining.push(violation);
    return;
  }
  if (outcome.kind === "unreasoned") {
    result.unreasonedSuppressions.push(outcome.violation);
  }
}

export interface SuppressionResult {
  readonly remaining: Violation[];
  readonly unreasonedSuppressions: Violation[];
}

export function applySuppressions(
  violations: readonly Violation[],
  readFile: (filePath: string) => string,
): SuppressionResult {
  const result: SuppressionResult = { remaining: [], unreasonedSuppressions: [] };
  const directivesByFile = new Map<string, SuppressionDirective[]>();

  for (const violation of violations) {
    const directives = getDirectivesForFile(violation.filePath, readFile, directivesByFile);
    const outcome = resolveSuppressionOutcome(violation, directives);
    appendSuppressionOutcome(outcome, violation, result);
  }

  return result;
}
