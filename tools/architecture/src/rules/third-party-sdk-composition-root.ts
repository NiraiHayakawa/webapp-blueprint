import type { Project, SourceFile } from "ts-morph";
import { getModuleReferences, matchesModuleSpecifier } from "../import-resolution.ts";
import type { Violation } from "../violation.ts";
import path from "node:path";

const RULE_ID = "third-party-sdk-composition-root";

interface ThirdPartySdkCompositionRootOptions {
  /**
   * 合成ルートに閉じ込めるべきサードパーティ SDK / SaaS クライアントのモジュール名一覧
   * （design §3「サードパーティ SDK / SaaS クライアントの import は合成ルート
   * 1 ファイルに閉じる」）。
   * どの SDK を対象にするかはプロジェクトのドメインに依存するため、既定値は空。
   * 空のままではこのルールは対象ゼロで通過する（transport-client-location と同じ理由）。
   */
  readonly restrictedModuleSpecifiers: readonly string[];
  /** 合成ルートとして許可するファイル名（拡張子込み。既定: "composition.ts"）。 */
  readonly compositionRootFileNames?: readonly string[];
}

/**
 * テスト/spec ファイルはこのルールの対象外にする（layer-dependency.ts の
 * isTestFile と同じ理由）。in-memory exporter を使って「span が実際に開いて
 * 閉じること」を検証するテスト（apps/api/src/logging/observe.test.ts）は、
 * 合成ルートと同型の組み立て（SDK の具象クラスを手で new する）をテストの
 * 粒度で行う正当なパターンであり、この「本番コードの依存グラフ」に対する
 * 制約はテストの組み立てコードには適用しない。
 */
function isTestFile(filePath: string): boolean {
  return /\.(?<kind>test|spec)\.tsx?$/u.test(path.basename(filePath));
}

/**
 * 合成ルートはファイル名だけで判定する。当初は「application レイヤ配下」も
 * 要求していたが、この最小の縦切りの実際の合成ルート
 * （apps/api/src/composition.ts）は DDD レイヤ（domain/application/
 * infrastructure/presentation）の外側でそれらを束ねる 1 ファイルであり、
 * "application" セグメントの祖先を持たない。ディレクトリ要件はこの実体と
 * 矛盾しており、実際に restrictedModuleSpecifiers を有効値で運用すると
 * 合成ルート自身が誤検知される（2026-08-09 実測: OpenTelemetry SDK の
 * 導入で顕在化）。命名規約（既定 "composition.ts"）は 1 プロジェクトに
 * 高々 1 つという前提を保つのに十分であり、ディレクトリでの絞り込みは
 * 過剰制約だった。
 */
function isCompositionRootFile(
  filePath: string,
  compositionRootFileNames: readonly string[],
): boolean {
  return compositionRootFileNames.includes(path.basename(filePath));
}

function collectViolationsFor(
  sourceFile: SourceFile,
  restrictedModuleSpecifiers: readonly string[],
): Violation[] {
  const filePath = sourceFile.getFilePath();
  const violations: Violation[] = [];

  for (const reference of getModuleReferences(sourceFile)) {
    const restrictedModule = restrictedModuleSpecifiers.find((moduleName) =>
      matchesModuleSpecifier(reference.moduleSpecifierText, moduleName),
    );
    if (restrictedModule === undefined) {
      continue;
    }

    violations.push({
      filePath,
      line: reference.line,
      ruleId: RULE_ID,
      hint: `サードパーティ SDK "${restrictedModule}" の import は合成ルート（composition.ts）に閉じること`,
    });
  }

  return violations;
}

function check(project: Project, options: ThirdPartySdkCompositionRootOptions): Violation[] {
  if (options.restrictedModuleSpecifiers.length === 0) {
    return [];
  }

  const compositionRootFileNames = options.compositionRootFileNames ?? [
    "composition.ts",
    "composition.tsx",
  ];
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (isTestFile(filePath) || isCompositionRootFile(filePath, compositionRootFileNames)) {
      continue;
    }
    violations.push(...collectViolationsFor(sourceFile, options.restrictedModuleSpecifiers));
  }

  return violations;
}

export { RULE_ID, check };
export type { ThirdPartySdkCompositionRootOptions };
