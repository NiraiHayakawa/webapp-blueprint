import {
  type ArrayLiteralExpression,
  type CallExpression,
  Node,
  type Project,
  type SourceFile,
} from "ts-morph";
import type { Violation } from "../violation.ts";

const RULE_ID = "test-each-notation";

const FIELD_INTERPOLATION_PATTERN = /\$[A-Za-z_][A-Za-z0-9_]*/u;

/** `it.each` / `test.each` の呼び出しかどうか（`it.skip.each` 等の中間チェーンも許可）。 */
function isEachCallee(calleeText: string): boolean {
  return /^(?<method>it|test)(?<chain>\.\w+)*\.each$/u.test(calleeText);
}

/**
 * `it.each(table)(name, fn)` の外側の呼び出し（name, fn を受け取る側）を集める。
 * table-driven の記法は design §5「テスト記法（it.each のタプル形式禁止、
 * テスト名に $field 補間必須）」の対象。
 */
function findEachCalls(sourceFile: SourceFile): CallExpression[] {
  return sourceFile
    .getDescendants()
    .filter((node) => Node.isCallExpression(node))
    .filter((call) => {
      const innerCall = call.getExpression();
      if (!Node.isCallExpression(innerCall)) {
        return false;
      }
      return isEachCallee(innerCall.getExpression().getText());
    });
}

/** `it.each(table)(...)` の `table` 部分。配列リテラルでなければ判定対象外。 */
function getEachTableArgument(outerCall: CallExpression): ArrayLiteralExpression | undefined {
  const innerCall = outerCall.getExpression();
  if (!Node.isCallExpression(innerCall)) {
    return undefined;
  }
  const [tableArgument] = innerCall.getArguments();
  if (tableArgument === undefined || !Node.isArrayLiteralExpression(tableArgument)) {
    // 変数参照は静的に判定不能
    return undefined;
  }
  return tableArgument;
}

/** table の要素にタプル（配列リテラル）が含まれるか。含まれていれば禁止対象。 */
function isTupleTable(tableArgument: ArrayLiteralExpression): boolean {
  return tableArgument.getElements().some((element) => Node.isArrayLiteralExpression(element));
}

/** table の要素が全て object リテラルの、空でない table か。 */
function isObjectTable(tableArgument: ArrayLiteralExpression): boolean {
  const elements = tableArgument.getElements();
  return (
    elements.length > 0 && elements.every((element) => Node.isObjectLiteralExpression(element))
  );
}

/** テスト名（`it.each(table)(name, fn)` の name）に `$field` 補間が無いか。 */
function isMissingFieldInterpolation(outerCall: CallExpression): boolean {
  const [nameArgument] = outerCall.getArguments();
  if (nameArgument === undefined || !Node.isStringLiteral(nameArgument)) {
    return false;
  }
  return !FIELD_INTERPOLATION_PATTERN.test(nameArgument.getLiteralText());
}

function evaluateEachCall(outerCall: CallExpression, filePath: string): Violation | undefined {
  const tableArgument = getEachTableArgument(outerCall);
  if (tableArgument === undefined) {
    return undefined;
  }

  if (isTupleTable(tableArgument)) {
    return {
      filePath,
      line: outerCall.getStartLineNumber(),
      ruleId: RULE_ID,
      hint: "it.each / test.each のタプル形式は禁止。object table 形式にすること",
    };
  }

  if (!isObjectTable(tableArgument) || !isMissingFieldInterpolation(outerCall)) {
    return undefined;
  }

  return {
    filePath,
    line: outerCall.getStartLineNumber(),
    ruleId: RULE_ID,
    hint: "object table 形式の it.each / test.each はテスト名に $field 補間が必須",
  };
}

function check(project: Project): Violation[] {
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    for (const outerCall of findEachCalls(sourceFile)) {
      const violation = evaluateEachCall(outerCall, filePath);
      if (violation === undefined) {
        continue;
      }
      violations.push(violation);
    }
  }

  return violations;
}

export { RULE_ID, check };
