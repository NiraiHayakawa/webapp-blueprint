import type { Project, SourceFile } from "ts-morph";
import { getModuleReferences, matchesModuleSpecifier } from "../import-resolution.ts";
import type { Violation } from "../violation.ts";

const RULE_ID = "transport-client-location";

interface TransportClientLocationOptions {
  /**
   * transport / client 生成ライブラリのモジュール名一覧。
   * 契約層は ADR 0001 で選ぶ空スロット（design §6）であり、テンプレート本体は
   * どの契約層も選ばないため、既定値は空にする。契約層を選んだ時点で、
   * その契約層のレシピが実際の生成ライブラリ名（例: "@connectrpc/connect"）を
   * ここに渡す。空のままだとこのルールは常に対象ゼロで通過する
   * （報告に明記。受入条件1「対象ゼロの緑は不合格」はテンプレート全体の
   * 縦切りに対する条件であり、この個別ルールが空スロットである間 no-op なのは
   * 契約層が空だという設計そのものの反映であって、隠れた不備ではない）。
   */
  readonly transportModuleSpecifiers: readonly string[];
  /** 生成・構築が許されるディレクトリ名（既定: "transport"）。 */
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
  transportModuleSpecifiers: readonly string[],
  allowedDirectoryNames: readonly string[],
): Violation[] {
  const filePath = sourceFile.getFilePath();
  const violations: Violation[] = [];

  for (const reference of getModuleReferences(sourceFile)) {
    const isTransportModule = transportModuleSpecifiers.some((moduleName) =>
      matchesModuleSpecifier(reference.moduleSpecifierText, moduleName),
    );
    if (!isTransportModule) {
      continue;
    }

    violations.push({
      filePath,
      line: reference.line,
      ruleId: RULE_ID,
      hint: `transport / client の生成は ${allowedDirectoryNames.join(" / ")} ディレクトリ配下でのみ許可される（"${reference.moduleSpecifierText}"）`,
    });
  }

  return violations;
}

function check(project: Project, options: TransportClientLocationOptions): Violation[] {
  if (options.transportModuleSpecifiers.length === 0) {
    return [];
  }

  const allowedDirectoryNames = options.allowedDirectoryNames ?? ["transport"];
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (isInsideAllowedDirectory(sourceFile.getFilePath(), allowedDirectoryNames)) {
      continue;
    }
    violations.push(
      ...collectViolationsFor(sourceFile, options.transportModuleSpecifiers, allowedDirectoryNames),
    );
  }

  return violations;
}

export { RULE_ID, check };
export type { TransportClientLocationOptions };
