import type { Project, SourceFile } from "ts-morph";
import { getModuleReferences, isBareModuleSpecifier } from "../import-resolution.ts";
import type { Violation } from "../violation.ts";
import path from "node:path";

const RULE_ID = "layer-dependency";

/**
 * テスト/spec ファイルはこのルールの対象外にする。
 *
 * 実際の縦切り実装（apps/api/src/domain/task/task.test.ts が "vitest" を
 * import、apps/api/src/application/register-task/register-task.spec.ts が
 * infrastructure の InMemoryTaskRepository を import して use case をテスト
 * している）を対象に checker を動かして見つけた。domain がテストランナーに
 * 依存するのは自然であり、application 層の spec が port の具象実装を手で
 * 組み立てて use case を検証するのは、DI コンテナを使わない手組み DI の
 * テストとして正当なパターンである（composition root と同型の組み立てを
 * テストの粒度で行っているだけ）。この一方通行の制約は「本番コードの依存
 * グラフ」に対するものであり、テストの組み立てコードには適用しない。
 */
function isTestFile(filePath: string): boolean {
  return /\.(?<kind>test|spec)\.tsx?$/u.test(path.basename(filePath));
}

/** DDD + Clean Architecture のレイヤ（design §3「バックエンド」）。 */
const LAYER_NAMES = ["domain", "application", "infrastructure", "presentation"] as const;
type Layer = (typeof LAYER_NAMES)[number];

/**
 * infrastructure と presentation は同じ外側の階層（rank 2）に属する兄弟であり、
 * 互いには依存しない（driven adapter と driving adapter は composition root
 * だけが束ねる。§3「サードパーティ SDK / SaaS クライアントの import は
 * 合成ルート 1 ファイルに閉じる」と同じ発想）。
 *
 * infrastructure/presentation を兄弟とする解釈は、spec の図
 * 「domain ← application ← infrastructure / presentation」を一意に
 * 決めるものではなく、Clean Architecture の一般的な driving/driven adapter
 * 分離から補った設計判断である（レビュー観点として報告に明記する）。
 *
 * 型注釈（`: Record<Layer, number>`）ではなく `satisfies` で書く理由: 注釈だと
 * 各レイヤの rank が number に潰れ、「presentation と infrastructure が同じ
 * 値である」という、このテーブルが表現している当の情報が型から消える。
 * `satisfies` なら 4 レイヤを漏れなく列挙している検査を効かせたまま、
 * リテラルの値を型に残せる。
 */
const LAYER_RANK = {
  domain: 0,
  application: 1,
  infrastructure: 2,
  presentation: 2,
} satisfies Record<Layer, number>;

function isLayer(segment: string): segment is Layer {
  return LAYER_NAMES.some((name) => name === segment);
}

function getLayer(filePath: string): Layer | undefined {
  const segments = filePath.split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment !== undefined && isLayer(segment)) {
      return segment;
    }
  }
  return undefined;
}

function isImportAllowed(fromLayer: Layer, toLayer: Layer): boolean {
  if (fromLayer === toLayer) {
    return true;
  }
  return LAYER_RANK[toLayer] < LAYER_RANK[fromLayer];
}

type ModuleReferenceItem = ReturnType<typeof getModuleReferences>[number];

/** 1 件の import 参照を、依存方向のルールに照らして評価する。 */
function evaluateReference(
  reference: ModuleReferenceItem,
  fromLayer: Layer,
  filePath: string,
): Violation | undefined {
  if (fromLayer === "domain" && isBareModuleSpecifier(reference.moduleSpecifierText)) {
    return {
      filePath,
      line: reference.line,
      ruleId: RULE_ID,
      hint: `domain は外部パッケージ "${reference.moduleSpecifierText}" を import できない`,
    };
  }

  if (reference.resolvedFile === undefined) {
    return undefined;
  }
  const toLayer = getLayer(reference.resolvedFile.getFilePath());
  if (toLayer === undefined) {
    return undefined;
  }

  if (isImportAllowed(fromLayer, toLayer)) {
    return undefined;
  }

  return {
    filePath,
    line: reference.line,
    ruleId: RULE_ID,
    hint: `${fromLayer} から ${toLayer} への import は依存方向に違反する`,
  };
}

function collectViolationsFor(sourceFile: SourceFile, fromLayer: Layer): Violation[] {
  const filePath = sourceFile.getFilePath();
  const violations: Violation[] = [];

  for (const reference of getModuleReferences(sourceFile)) {
    const violation = evaluateReference(reference, fromLayer, filePath);
    if (violation === undefined) {
      continue;
    }
    violations.push(violation);
  }

  return violations;
}

function check(project: Project): Violation[] {
  const violations: Violation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (isTestFile(filePath)) {
      continue;
    }
    const fromLayer = getLayer(filePath);
    if (fromLayer === undefined) {
      continue;
    }
    violations.push(...collectViolationsFor(sourceFile, fromLayer));
  }

  return violations;
}

export { RULE_ID, check };
