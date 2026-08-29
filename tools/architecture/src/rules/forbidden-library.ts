import { getModuleReferences, matchesModuleSpecifier } from "../import-resolution.ts";
import type { Project } from "ts-morph";
import type { Violation } from "../violation.ts";

const RULE_ID = "forbidden-library";

/**
 * design §5「禁止ライブラリ（DI コンテナ・effect・neverthrow・p-retry）」。
 *
 * DI コンテナは spec 上「カテゴリ」として言及されており個別名の網羅は spec に
 * 書かれていないため、広く使われている代表的なパッケージ名を暫定リストとして
 * ここに置く（報告に明記。将来増減があれば PR でこの配列を直接編集する —
 * 抑制コメントで個別に許可するのではなく、リストそのものを変える）。
 */
const FORBIDDEN_MODULES = [
  "effect",
  "neverthrow",
  "p-retry",
  "inversify",
  "tsyringe",
  "typedi",
  "awilix",
  "injection-js",
] as const;

function check(project: Project): Violation[] {
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    for (const reference of getModuleReferences(sourceFile)) {
      const forbiddenModule = FORBIDDEN_MODULES.find((moduleName) =>
        matchesModuleSpecifier(reference.moduleSpecifierText, moduleName),
      );
      if (forbiddenModule === undefined) {
        continue;
      }

      violations.push({
        filePath,
        line: reference.line,
        ruleId: RULE_ID,
        hint: `"${forbiddenModule}" は禁止ライブラリ（DI コンテナ・原則2 fail-fast と手組み DI の機械強制）`,
      });
    }
  }

  return violations;
}

export { RULE_ID, check };
