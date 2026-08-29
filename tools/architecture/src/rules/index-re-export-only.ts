import { Node, type Project, type SourceFile } from "ts-morph";
import type { Violation } from "../violation.ts";
import { getNearestFeatureScope } from "../feature-scope.ts";
import path from "node:path";

const RULE_ID = "index-re-export-only";

function isIndexFile(filePath: string): boolean {
  return /^index\.tsx?$/u.test(path.basename(filePath));
}

/**
 * ルールの対象は「公開面としての index」だけに絞る（design §3
 * 「features/ ... 公開面は index のみ」/「workspace パッケージの公開面」）。
 *
 * 実際の縦切り実装で apps/web/src/routes/index.ts を確認したところ、
 * これはルーティングテーブルそのもの（`export const routes = [...]`）であり
 * feature/package の公開面バレルではない。「index という名前のファイルは
 * すべて re-export のみ」まで広げると、この正当なファイルを誤検知するため、
 * 対象を features/ 自身の index と packages/ contract/ 配下の index に限定する。
 */
function isPublicFaceIndexFile(filePath: string): boolean {
  const featureScope = getNearestFeatureScope(filePath);
  if (featureScope !== undefined && path.dirname(filePath) === featureScope.dirPath) {
    return true;
  }
  const segments = filePath.split("/");
  return segments.includes("packages") || segments.includes("contract");
}

function collectViolationsFor(sourceFile: SourceFile): Violation[] {
  const filePath = sourceFile.getFilePath();
  const violations: Violation[] = [];

  for (const statement of sourceFile.getStatements()) {
    const isReExport = Node.isExportDeclaration(statement) && statement.hasModuleSpecifier();
    if (isReExport) {
      continue;
    }

    violations.push({
      filePath,
      line: statement.getStartLineNumber(),
      ruleId: RULE_ID,
      hint: "index は re-export（module specifier 付き export ... from）以外の宣言を持てない",
    });
  }

  return violations;
}

/** design §5「index は re-export のみ」。許可されるのは module specifier 付き export 宣言だけ。 */
function check(project: Project): Violation[] {
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (!isIndexFile(filePath) || !isPublicFaceIndexFile(filePath)) {
      continue;
    }
    violations.push(...collectViolationsFor(sourceFile));
  }

  return violations;
}

export { RULE_ID, check };
