import type { InterfaceDeclaration, Project, TypeAliasDeclaration } from "ts-morph";
import type { Violation } from "../violation.ts";
import path from "node:path";

const RULE_ID = "repository-aggregate-root";

/**
 * 「repository は aggregate root にのみ生やす」（design §3 バックエンド）の判定。
 *
 * spec は repository interface の置き場所を domain/ と明記する一方（§3
 * 「domain/ ... repository interface」）、application/ 側も
 * 「port（interface 集約）」を持つとしており、実際の縦切り実装
 * （apps/api/src/application/register-task/register-task.port.ts の
 * `TaskRepository`）は application/<use-case>/ 配下に port として置いている。
 * この置き場所の食い違いは spec 自体の §3 の記述間で解消されていないため、
 * 本ルールはファイルの場所ではなく **シンボル名の対応** で判定する
 * （domain 層側の食い違いはレビュー観点として報告に明記する）。
 *
 * 判定手順:
 * 1. domain/<dir>/ 配下に、dir 名を PascalCase 化した名前の export された
 *    class/interface があれば、それを aggregate root として登録する
 * 2. プロジェクト全体から `<Subject>Repository` という名前の export された
 *    interface/type alias を集める（class は対象外 — 駆動アダプタの実装
 *    クラスは自由な名前で port を実装してよく、例えば
 *    `InMemoryTaskRepository implements TaskRepository` の実装クラス名まで
 *    aggregate root 名と一致させる必要はない）
 * 3. Subject が既知の aggregate root 名と一致しなければ違反
 */
function toPascalCase(name: string): string {
  return name
    .split(/[-_]/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

/** domain/<dir>/ の連なりから、dir 名（aggregate 候補の名前）の集合を集める。 */
function collectAggregateDirNames(project: Project): Set<string> {
  const aggregateDirNames = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    const segments = sourceFile.getFilePath().split("/");
    const domainIndex = segments.lastIndexOf("domain");
    if (domainIndex === -1) {
      continue;
    }
    const aggregateDirName = segments[domainIndex + 1];
    if (aggregateDirName !== undefined) {
      aggregateDirNames.add(aggregateDirName);
    }
  }

  return aggregateDirNames;
}

/** domain/<aggregateDirName>/ 配下に、export された `<expectedRootName>` class/interface があるか。 */
function hasAggregateRootDeclaration(
  project: Project,
  aggregateDirName: string,
  expectedRootName: string,
): boolean {
  return project.getSourceFiles().some((sourceFile) => {
    const segments = sourceFile.getFilePath().split("/");
    const domainIndex = segments.lastIndexOf("domain");
    if (domainIndex === -1 || segments[domainIndex + 1] !== aggregateDirName) {
      return false;
    }
    const hasClass = sourceFile
      .getClasses()
      .some(
        (declaration) => declaration.isExported() && declaration.getName() === expectedRootName,
      );
    const hasInterface = sourceFile
      .getInterfaces()
      .some(
        (declaration) => declaration.isExported() && declaration.getName() === expectedRootName,
      );
    return hasClass || hasInterface;
  });
}

function collectAggregateRootNames(project: Project): Set<string> {
  const rootNames = new Set<string>();

  for (const aggregateDirName of collectAggregateDirNames(project)) {
    const expectedRootName = toPascalCase(aggregateDirName);
    if (hasAggregateRootDeclaration(project, aggregateDirName, expectedRootName)) {
      rootNames.add(expectedRootName);
    }
  }

  return rootNames;
}

interface RepositoryDeclaration {
  readonly filePath: string;
  readonly line: number;
  readonly subject: string;
}

function collectRepositoryDeclarations(project: Project): RepositoryDeclaration[] {
  const declarations: RepositoryDeclaration[] = [];

  const record = (
    declaration: InterfaceDeclaration | TypeAliasDeclaration,
    sourceFilePath: string,
  ): void => {
    if (!declaration.isExported()) {
      return;
    }
    const name = declaration.getName();
    const match = /^(?<subject>.+)Repository$/u.exec(name);
    const subject = match?.groups?.["subject"];
    if (subject === undefined) {
      return;
    }
    declarations.push({
      filePath: sourceFilePath,
      line: declaration.getStartLineNumber(),
      subject,
    });
  };

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    for (const declaration of sourceFile.getInterfaces()) {
      record(declaration, filePath);
    }
    for (const declaration of sourceFile.getTypeAliases()) {
      record(declaration, filePath);
    }
  }

  return declarations;
}

function check(project: Project): Violation[] {
  const aggregateRootNames = collectAggregateRootNames(project);
  const violations: Violation[] = [];

  for (const declaration of collectRepositoryDeclarations(project)) {
    if (aggregateRootNames.has(declaration.subject)) {
      continue;
    }

    violations.push({
      filePath: declaration.filePath,
      line: declaration.line,
      ruleId: RULE_ID,
      hint: `"${declaration.subject}" は aggregate root ではない。repository は aggregate root（${path.basename(declaration.filePath)} が想定する対象）にのみ生やす`,
    });
  }

  return violations;
}

export { RULE_ID, check };
