import path from "node:path";

/**
 * 再帰的 features（design §3「フロントエンド: 再帰的 features」）における
 * 「最も深い features/X スコープ」を表す。
 */
interface FeatureScope {
  readonly name: string;
  /** このスコープのディレクトリの絶対パス（例: .../src/features/foo/features/bar） */
  readonly dirPath: string;
}

/**
 * ファイルパスに含まれる `features/<name>` の連なりを、外側から内側の順で返す。
 * 例: .../src/features/foo/features/bar/component.ts
 *   -> [{ name: "foo", dirPath: ".../src/features/foo" },
 *       { name: "bar", dirPath: ".../src/features/foo/features/bar" }]
 */
function getFeatureScopeChain(filePath: string): FeatureScope[] {
  const segments = filePath.split(path.sep);
  const chain: FeatureScope[] = [];

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== "features") {
      continue;
    }
    const name = segments[index + 1];
    if (name === undefined) {
      continue;
    }
    chain.push({
      name,
      dirPath: segments.slice(0, index + 2).join(path.sep),
    });
  }

  return chain;
}

/** ファイルを直接内包する、最も深い features スコープ。features 配下でなければ undefined。 */
function getNearestFeatureScope(filePath: string): FeatureScope | undefined {
  const chain = getFeatureScopeChain(filePath);
  return chain.at(-1);
}

type FeatureRelationship = "same" | "descendant" | "ancestor" | "sibling" | "unrelated";

/**
 * importer のスコープから見て target のスコープがどの関係にあるかを判定する。
 *
 * 判定基準は design §5 の受け皿記述そのもの:
 * 「最も深い features/X スコープを抽出し、子孫・兄弟のみ許可、
 *   親・いとこ・祖先・他 feature 内部は違反」。
 */
function classifyFeatureRelationship(
  importerDirPath: string,
  targetDirPath: string,
): FeatureRelationship {
  if (importerDirPath === targetDirPath) {
    return "same";
  }
  if (targetDirPath.startsWith(`${importerDirPath}${path.sep}`)) {
    return "descendant";
  }
  if (importerDirPath.startsWith(`${targetDirPath}${path.sep}`)) {
    return "ancestor";
  }
  if (path.dirname(importerDirPath) === path.dirname(targetDirPath)) {
    return "sibling";
  }
  return "unrelated";
}

/** 指定したスコープの公開エントリポイント（index.ts / index.tsx）の絶対パス一覧。 */
function getFeatureIndexPaths(scope: FeatureScope): string[] {
  return [".ts", ".tsx"].map((extension) => path.join(scope.dirPath, `index${extension}`));
}

/** ファイルが、指定したスコープ自身が持つ index.ts / index.tsx かどうか。 */
function isFeatureIndexFile(filePath: string, scope: FeatureScope): boolean {
  return getFeatureIndexPaths(scope).includes(filePath);
}

export {
  getFeatureScopeChain,
  getNearestFeatureScope,
  classifyFeatureRelationship,
  isFeatureIndexFile,
};
