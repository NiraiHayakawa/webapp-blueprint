import { Node, type Project, type SourceFile } from "ts-morph";
import type { Violation } from "../violation.ts";
import path from "node:path";
import { walkFiles } from "../file-walk.ts";

const RULE_ID = "feature-spec-pairing";

/**
 * design §4「`.feature` を spec と colocate」/ §5
 * 「`.feature` と spec の対応（片方だけ存在する状態を禁止）」。
 *
 * 対応の判定は「spec ファイルの中に、対象の `.feature` を指す文字列リテラルが
 * ある」ことで行う（`@amiceli/vitest-cucumber` の `loadFeature("./x.feature")`
 * のような呼び出しを想定）。ディレクトリ内の同名ファイルを機械的に対にする
 * だけでは、ドメインの table-driven テスト（`.feature` を持たない spec）まで
 * 誤検知するため採らない。
 */
function getFeatureFileReferences(sourceFile: SourceFile): string[] {
  const directory = path.dirname(sourceFile.getFilePath());
  const references: string[] = [];

  for (const literal of sourceFile.getDescendants().filter((node) => Node.isStringLiteral(node))) {
    const literalText = literal.getLiteralText();
    if (!literalText.endsWith(".feature")) {
      continue;
    }
    references.push(path.resolve(directory, literalText));
  }

  return references;
}

function isSpecFile(filePath: string): boolean {
  return /\.spec\.tsx?$/u.test(path.basename(filePath));
}

/** scanRoots 配下に存在する `.feature` ファイルの絶対パス一覧を集める。 */
function collectFeatureFiles(scanRoots: readonly string[]): Set<string> {
  const featureFiles = new Set<string>();
  for (const scanRoot of scanRoots) {
    for (const filePath of walkFiles(scanRoot)) {
      if (filePath.endsWith(".feature")) {
        featureFiles.add(filePath);
      }
    }
  }
  return featureFiles;
}

interface SpecFileScanResult {
  readonly violations: Violation[];
  readonly referencedFeatureFiles: string[];
}

/** 1 つの spec ファイルが参照する `.feature` を集め、存在しない参照を違反として報告する。 */
function scanSpecFile(
  sourceFile: SourceFile,
  featureFiles: ReadonlySet<string>,
): SpecFileScanResult {
  const filePath = sourceFile.getFilePath();
  const violations: Violation[] = [];
  const referencedFeatureFiles: string[] = [];

  for (const referencedPath of getFeatureFileReferences(sourceFile)) {
    referencedFeatureFiles.push(referencedPath);
    if (!featureFiles.has(referencedPath)) {
      violations.push({
        filePath,
        line: 1,
        ruleId: RULE_ID,
        hint: `spec が参照する "${path.basename(referencedPath)}" が存在しない`,
      });
    }
  }

  return { violations, referencedFeatureFiles };
}

interface SpecScanResult {
  readonly violations: Violation[];
  readonly referencedFeatureFiles: ReadonlySet<string>;
}

/** project 内の全 spec ファイルを走査し、違反と「参照された .feature」の集合をまとめる。 */
function collectSpecScanResult(
  project: Project,
  featureFiles: ReadonlySet<string>,
): SpecScanResult {
  const violations: Violation[] = [];
  const referencedFeatureFiles: string[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (!isSpecFile(sourceFile.getFilePath())) {
      continue;
    }
    const result = scanSpecFile(sourceFile, featureFiles);
    violations.push(...result.violations);
    referencedFeatureFiles.push(...result.referencedFeatureFiles);
  }

  return { violations, referencedFeatureFiles: new Set(referencedFeatureFiles) };
}

/** どの spec からも参照されない `.feature`（孤立した feature ファイル）を違反として報告する。 */
function collectOrphanFeatureViolations(
  featureFiles: ReadonlySet<string>,
  referencedFeatureFiles: ReadonlySet<string>,
): Violation[] {
  const violations: Violation[] = [];
  for (const featureFile of featureFiles) {
    if (!referencedFeatureFiles.has(featureFile)) {
      violations.push({
        filePath: featureFile,
        line: 1,
        ruleId: RULE_ID,
        hint: "この .feature を読み込む spec が見つからない",
      });
    }
  }
  return violations;
}

function check(project: Project, scanRoots: readonly string[]): Violation[] {
  const featureFiles = collectFeatureFiles(scanRoots);
  const specScanResult = collectSpecScanResult(project, featureFiles);
  const orphanViolations = collectOrphanFeatureViolations(
    featureFiles,
    specScanResult.referencedFeatureFiles,
  );
  return [...specScanResult.violations, ...orphanViolations];
}

export { RULE_ID, check };
