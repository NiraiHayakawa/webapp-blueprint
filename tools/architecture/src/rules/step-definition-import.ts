import type { Project, SourceFile } from "ts-morph";
import type { Violation } from "../violation.ts";
import { getModuleReferences } from "../import-resolution.ts";
import path from "node:path";

const RULE_ID = "step-definition-import";

/**
 * design §5「step 定義から import できるのは公開エントリポイントのみ」。
 *
 * step 定義ファイルの命名規約は spec に明記されていないため、
 * playwright-bdd / @amiceli/vitest-cucumber の一般的な慣習である
 * `*.steps.ts` を対象とする（報告に明記。実装が固まった時点で見直す）。
 */
function isStepDefinitionFile(filePath: string): boolean {
  return /\.steps\.tsx?$/u.test(path.basename(filePath));
}

function isIndexFile(filePath: string): boolean {
  return /^index\.tsx?$/u.test(path.basename(filePath));
}

function collectViolationsFor(sourceFile: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const filePath = sourceFile.getFilePath();

  for (const reference of getModuleReferences(sourceFile)) {
    // 外部パッケージ（BDD ライブラリ等）は対象外
    if (reference.resolvedFile === undefined) {
      continue;
    }
    const targetPath = reference.resolvedFile.getFilePath();
    if (isIndexFile(targetPath)) {
      continue;
    }

    violations.push({
      filePath,
      line: reference.line,
      ruleId: RULE_ID,
      hint: `step 定義からは公開エントリポイント（index）以外を import できない（"${path.basename(targetPath)}"）`,
    });
  }

  return violations;
}

function check(project: Project): Violation[] {
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (!isStepDefinitionFile(sourceFile.getFilePath())) {
      continue;
    }
    violations.push(...collectViolationsFor(sourceFile));
  }

  return violations;
}

export { RULE_ID, check };
