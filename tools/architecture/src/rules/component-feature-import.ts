import type { Project, SourceFile } from "ts-morph";
import type { Violation } from "../violation.ts";
import { getModuleReferences } from "../import-resolution.ts";
import { getNearestFeatureScope } from "../feature-scope.ts";

const RULE_ID = "component-feature-import";

/** `components/` から `features/` への import 禁止（design §5）。公開面経由でも不可の全面禁止。 */
function isInsideComponentsDir(filePath: string): boolean {
  return filePath.split("/").includes("components");
}

function collectViolationsFor(sourceFile: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const filePath = sourceFile.getFilePath();

  for (const reference of getModuleReferences(sourceFile)) {
    if (reference.resolvedFile === undefined) {
      continue;
    }
    const targetScope = getNearestFeatureScope(reference.resolvedFile.getFilePath());
    if (targetScope === undefined) {
      continue;
    }

    violations.push({
      filePath,
      line: reference.line,
      ruleId: RULE_ID,
      hint: `components/ から feature "${targetScope.name}" への import は禁止`,
    });
  }

  return violations;
}

function check(project: Project): Violation[] {
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (!isInsideComponentsDir(sourceFile.getFilePath())) {
      continue;
    }
    violations.push(...collectViolationsFor(sourceFile));
  }

  return violations;
}

export { RULE_ID, check };
