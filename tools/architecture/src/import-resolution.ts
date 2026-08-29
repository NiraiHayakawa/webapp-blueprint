import type { SourceFile } from "ts-morph";

/**
 * `import ... from "..."` と `export ... from "..."`（re-export）を
 * 同一の形で扱うための参照 1 件。
 *
 * レイヤ依存方向・feature 境界などのルールは「どのファイルからどのファイルへ
 * 依存が伸びているか」だけを見るため、import と re-export を区別しない。
 */
interface ModuleReference {
  readonly moduleSpecifierText: string;
  readonly resolvedFile: SourceFile | undefined;
  readonly line: number;
}

/**
 * node_modules 配下（サードパーティパッケージの型定義ファイル等）に解決された
 * ファイルは、このモジュール群が扱う「内部依存グラフ」の対象外として扱う。
 *
 * ts-morph の `getModuleSpecifierSourceFile()` は bare specifier（例:
 * "@playwright/test"）も node_modules 内の .d.ts に解決してしまうため、
 * 「解決できた = プロジェクト内部ファイル」という前提のまま各ルールに渡すと、
 * 外部パッケージの import を「内部ファイルへの直接 import」と誤検知する
 * （実際に e2e/steps/*.steps.ts の "@playwright/test" import で発生した。
 * 実装の縦切りを対象に checker を動かして見つけたバグ）。
 */
function isWithinNodeModules(filePath: string): boolean {
  return filePath.split("/").includes("node_modules");
}

function getModuleReferences(sourceFile: SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];

  const resolveInternal = (resolved: SourceFile | undefined): SourceFile | undefined => {
    if (resolved === undefined) {
      return undefined;
    }
    if (isWithinNodeModules(resolved.getFilePath())) {
      return undefined;
    }
    return resolved;
  };

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    references.push({
      moduleSpecifierText: importDeclaration.getModuleSpecifierValue(),
      resolvedFile: resolveInternal(importDeclaration.getModuleSpecifierSourceFile()),
      line: importDeclaration.getStartLineNumber(),
    });
  }

  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    if (!exportDeclaration.hasModuleSpecifier()) {
      continue;
    }
    references.push({
      moduleSpecifierText: exportDeclaration.getModuleSpecifierValue() ?? "",
      resolvedFile: resolveInternal(exportDeclaration.getModuleSpecifierSourceFile()),
      line: exportDeclaration.getStartLineNumber(),
    });
  }

  return references;
}

/** bare specifier（相対パスでも絶対パスでもない = 外部パッケージ）かどうか。 */
function isBareModuleSpecifier(specifierText: string): boolean {
  return !specifierText.startsWith(".") && !specifierText.startsWith("/");
}

/** specifier が指定したモジュール名（またはそのサブパス）を指しているか。 */
function matchesModuleSpecifier(specifierText: string, moduleName: string): boolean {
  return specifierText === moduleName || specifierText.startsWith(`${moduleName}/`);
}

export { getModuleReferences, isBareModuleSpecifier, matchesModuleSpecifier };
