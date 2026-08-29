import type { Project, SourceFile } from "ts-morph";
import {
  classifyFeatureRelationship,
  getFeatureScopeChain,
  getNearestFeatureScope,
  isFeatureIndexFile,
} from "../feature-scope.ts";
import type { Violation } from "../violation.ts";
import { getModuleReferences } from "../import-resolution.ts";
import path from "node:path";

const RULE_ID = "feature-boundary";

type FeatureScopeInfo = NonNullable<ReturnType<typeof getNearestFeatureScope>>;
type ModuleReferenceItem = ReturnType<typeof getModuleReferences>[number];

interface ReferenceEvaluationContext {
  readonly importerPath: string;
  readonly importerScope: FeatureScopeInfo | undefined;
  readonly line: number;
}

/**
 * features/ の外（routes/ components/ lib/ など）からの参照を判定する。
 * ネストした子 feature は親 feature の内部実装であり、外から直接見えない。
 */
function evaluateOutsideFeatureReference(
  context: ReferenceEvaluationContext,
  targetPath: string,
  targetScope: FeatureScopeInfo,
): Violation | undefined {
  if (getFeatureScopeChain(targetPath).length <= 1) {
    return undefined;
  }
  return {
    filePath: context.importerPath,
    line: context.line,
    ruleId: RULE_ID,
    hint: `feature 外から入れ子の feature "${targetScope.name}" の内部には import できない`,
  };
}

/** feature 同士の関係（親・いとこ・祖先・他 feature 内部）が禁止対象かどうかを判定する。 */
function evaluateRelationshipViolation(
  context: ReferenceEvaluationContext,
  importerScope: FeatureScopeInfo,
  targetScope: FeatureScopeInfo,
): Violation | undefined {
  const relationship = classifyFeatureRelationship(importerScope.dirPath, targetScope.dirPath);
  if (relationship === "ancestor") {
    return {
      filePath: context.importerPath,
      line: context.line,
      ruleId: RULE_ID,
      hint: `feature "${importerScope.name}" から親 feature "${targetScope.name}" への import は禁止`,
    };
  }
  if (relationship === "unrelated") {
    return {
      filePath: context.importerPath,
      line: context.line,
      ruleId: RULE_ID,
      hint: `feature "${importerScope.name}" から祖先/いとこ feature "${targetScope.name}" への import は禁止`,
    };
  }
  // descendant / sibling は次の公開面チェックへ進む
  return undefined;
}

/** importer が feature の外か内かで、親・いとこ・祖先・他 feature 内部の判定を振り分ける。 */
function evaluateCrossFeatureViolation(
  context: ReferenceEvaluationContext,
  targetPath: string,
  targetScope: FeatureScopeInfo,
): Violation | undefined {
  if (context.importerScope === undefined) {
    return evaluateOutsideFeatureReference(context, targetPath, targetScope);
  }
  return evaluateRelationshipViolation(context, context.importerScope, targetScope);
}

/**
 * 再帰的 features の境界規則（design §3「フロントエンド: 再帰的 features」/
 * §5「feature 間 import は公開面経由のみ。親・他 feature 内部への import 禁止」）。
 *
 * 判定方針: 最も深い features/X スコープを抽出し、子孫・兄弟のみ許可、
 * 親・いとこ・祖先・他 feature 内部は違反とする。
 */
function evaluateReference(
  context: ReferenceEvaluationContext,
  targetPath: string,
  targetScope: FeatureScopeInfo,
): Violation[] {
  if (
    context.importerScope !== undefined &&
    context.importerScope.dirPath === targetScope.dirPath
  ) {
    // 同一 feature 内部の参照
    return [];
  }

  const crossFeatureViolation = evaluateCrossFeatureViolation(context, targetPath, targetScope);
  if (crossFeatureViolation !== undefined) {
    return [crossFeatureViolation];
  }

  if (isFeatureIndexFile(targetPath, targetScope)) {
    return [];
  }
  return [
    {
      filePath: context.importerPath,
      line: context.line,
      ruleId: RULE_ID,
      hint: `feature "${targetScope.name}" の内部ファイル "${path.basename(targetPath)}" への直接 import は禁止。公開面（index）経由にすること`,
    },
  ];
}

interface ResolvedTarget {
  readonly targetPath: string;
  readonly targetScope: FeatureScopeInfo;
}

/** 参照先を解決し、feature スコープに属さない参照（feature への import ではない）を除外する。 */
function resolveTargetScope(reference: ModuleReferenceItem): ResolvedTarget | undefined {
  if (reference.resolvedFile === undefined) {
    return undefined;
  }
  const targetPath = reference.resolvedFile.getFilePath();
  const targetScope = getNearestFeatureScope(targetPath);
  if (targetScope === undefined) {
    // feature への import ではない
    return undefined;
  }
  return { targetPath, targetScope };
}

function collectViolationsForSourceFile(sourceFile: SourceFile): Violation[] {
  const importerPath = sourceFile.getFilePath();
  const importerScope = getNearestFeatureScope(importerPath);
  const violations: Violation[] = [];

  for (const reference of getModuleReferences(sourceFile)) {
    const target = resolveTargetScope(reference);
    if (target === undefined) {
      continue;
    }
    violations.push(
      ...evaluateReference(
        { importerPath, importerScope, line: reference.line },
        target.targetPath,
        target.targetScope,
      ),
    );
  }

  return violations;
}

function check(project: Project): Violation[] {
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    violations.push(...collectViolationsForSourceFile(sourceFile));
  }

  return violations;
}

export { RULE_ID, check };
