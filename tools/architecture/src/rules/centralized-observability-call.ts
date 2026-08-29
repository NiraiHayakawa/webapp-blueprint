import { Node, type Project, type SourceFile } from "ts-morph";
import type { Violation } from "../violation.ts";
import path from "node:path";

const RULE_ID = "centralized-observability-call";

/**
 * 「業務コードは『何が起きたか』だけを渡す。ログ実装も HTTP への見せ方も知らない」
 * の機械強制。
 *
 * 業務コードが `console.*` を直接呼ぶことを禁止する。`console.*` は import を
 * 経由しないグローバルのため、logging-implementation-location（import specifier
 * ベース）では検出できない。パイプライン外の生ログ呼び出しを防ぐため、別ルール
 * として独立させる。
 *
 * ログ実装の選択に関わらず常時有効（transport-client-location や
 * logging-implementation-location と異なり、対象パッケージが未選択でも
 * `console.*` の直接呼び出しは常に横断境界を迂回する行為であるため、
 * 空設定で no-op にはしない）。
 */

/**
 * CLI ツール（design 報告の指示どおり scripts/ tools/ e2e/）は横断境界の
 * 対象外にする。これらは対話的なコマンドラインの標準出力そのものが
 * インターフェースであり、構造化ログの横断境界を通す対象ではないため。
 * 除外はディレクトリ単位・理由コメント付きで行う（原則4の抑制規律を
 * 「対象外にする」判断自体にも適用する）。
 *
 * `rootDir` から見た**最上位セグメントのみ**を見る（祖先パスのどこかに
 * 同名セグメントがあれば除外、という判定は採らない）。このルール自身が
 * `tools/architecture/` 配下に置かれているため、絶対パスの任意の祖先を見る
 * 判定だと、checker 自身の fixture（`tools/architecture/test/fixtures/...`）が
 * 常に「tools 配下」に誤判定される（実測: fixture 追加時に検出した）。
 * scripts/tools/e2e はいずれもモノレポ直下のトップレベルディレクトリという
 * 前提があるため、トップレベルセグメントだけを見れば十分であり、かつ
 * この誤判定を避けられる。
 */
const CLI_TOOL_DIRECTORY_NAMES = new Set(["scripts", "tools", "e2e"]);

interface CentralizedObservabilityCallOptions {
  /**
   * 横断境界の観測ヘルパー実装自身が置かれ、`console.*` の直接呼び出しが
   * 許されるディレクトリ名（既定: "logging"）。logging-implementation-location
   * の既定ディレクトリ名と揃える。任意の深さのディレクトリ（祖先パスの
   * どこかにこの名前のセグメントがあるか）で判定する。
   */
  readonly allowedDirectoryNames?: readonly string[];
}

function getTopLevelSegment(rootDir: string, filePath: string): string | undefined {
  const relativePath = path.relative(rootDir, filePath);
  return relativePath.split(path.sep)[0];
}

function isWithinCliToolDirectory(rootDir: string, filePath: string): boolean {
  const topLevelSegment = getTopLevelSegment(rootDir, filePath);
  return topLevelSegment !== undefined && CLI_TOOL_DIRECTORY_NAMES.has(topLevelSegment);
}

function isInsideAllowedDirectory(
  filePath: string,
  allowedDirectoryNames: readonly string[],
): boolean {
  const segments = filePath.split("/");
  return allowedDirectoryNames.some((name) => segments.includes(name));
}

/** `console` を指す PropertyAccessExpression（`console.log` 等）を集める。 */
function findConsolePropertyAccesses(sourceFile: SourceFile) {
  return sourceFile
    .getDescendants()
    .filter((node) => Node.isPropertyAccessExpression(node))
    .filter((node) => node.getExpression().getText() === "console");
}

function collectViolationsFor(sourceFile: SourceFile): Violation[] {
  const filePath = sourceFile.getFilePath();
  const violations: Violation[] = [];

  for (const access of findConsolePropertyAccesses(sourceFile)) {
    violations.push({
      filePath,
      line: access.getStartLineNumber(),
      ruleId: RULE_ID,
      hint: `"console.${access.getName()}" の直接呼び出しは禁止。横断境界の観測ヘルパー経由にすること`,
    });
  }

  return violations;
}

function check(
  project: Project,
  rootDir: string,
  options: CentralizedObservabilityCallOptions = {},
): Violation[] {
  const allowedDirectoryNames = options.allowedDirectoryNames ?? ["logging"];
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (isWithinCliToolDirectory(rootDir, filePath)) {
      continue;
    }
    if (isInsideAllowedDirectory(filePath, allowedDirectoryNames)) {
      continue;
    }
    violations.push(...collectViolationsFor(sourceFile));
  }

  return violations;
}

export { RULE_ID, check };
export type { CentralizedObservabilityCallOptions };
