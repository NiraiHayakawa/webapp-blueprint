import type { Project, SourceFile } from "ts-morph";
import { getModuleReferences, matchesModuleSpecifier } from "../import-resolution.ts";
import type { Violation } from "../violation.ts";

const RULE_ID = "logging-implementation-location";

/**
 * ログ実装（例: pino）の import を 1 ディレクトリに制限する
 * （ログ実装への依存を 1 箇所に集約し、業務コードがログ実装に直接依存することを防ぐ）。
 *
 * テンプレートはまだログ実装を選んでいない（design §6 の空スロット）ため、
 * 「ログ実装として宣言されたパッケージ群」を設定で受け取る汎用ルールにする。
 * transport-client-location・third-party-sdk-composition-root と同じ理由で、
 * 既定値は空配列。空のままではこのルールは対象ゼロで通過する。
 */
interface LoggingImplementationLocationOptions {
  /** ログ実装として宣言されたパッケージのモジュール名一覧（例: "pino"）。 */
  readonly loggingImplementationModuleSpecifiers: readonly string[];
  /** import を許可するディレクトリ名（既定: "logging"）。 */
  readonly allowedDirectoryNames?: readonly string[];
}

function isInsideAllowedDirectory(
  filePath: string,
  allowedDirectoryNames: readonly string[],
): boolean {
  const segments = filePath.split("/");
  return allowedDirectoryNames.some((name) => segments.includes(name));
}

function collectViolationsFor(
  sourceFile: SourceFile,
  loggingImplementationModuleSpecifiers: readonly string[],
  allowedDirectoryNames: readonly string[],
): Violation[] {
  const filePath = sourceFile.getFilePath();
  const violations: Violation[] = [];

  for (const reference of getModuleReferences(sourceFile)) {
    const loggingModule = loggingImplementationModuleSpecifiers.find((moduleName) =>
      matchesModuleSpecifier(reference.moduleSpecifierText, moduleName),
    );
    if (loggingModule === undefined) {
      continue;
    }

    violations.push({
      filePath,
      line: reference.line,
      ruleId: RULE_ID,
      hint: `ログ実装 "${loggingModule}" の import は ${allowedDirectoryNames.join(" / ")} ディレクトリ配下でのみ許可される`,
    });
  }

  return violations;
}

function check(project: Project, options: LoggingImplementationLocationOptions): Violation[] {
  if (options.loggingImplementationModuleSpecifiers.length === 0) {
    return [];
  }

  const allowedDirectoryNames = options.allowedDirectoryNames ?? ["logging"];
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (isInsideAllowedDirectory(sourceFile.getFilePath(), allowedDirectoryNames)) {
      continue;
    }
    violations.push(
      ...collectViolationsFor(
        sourceFile,
        options.loggingImplementationModuleSpecifiers,
        allowedDirectoryNames,
      ),
    );
  }

  return violations;
}

export { RULE_ID, check };
export type { LoggingImplementationLocationOptions };
