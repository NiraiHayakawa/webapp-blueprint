import {
  type ThirdPartySdkCompositionRootOptions,
  check as checkThirdPartySdkCompositionRoot,
} from "./rules/third-party-sdk-composition-root.ts";
import {
  type TransportClientLocationOptions,
  check as checkTransportClientLocation,
} from "./rules/transport-client-location.ts";
import { type Violation, formatViolation } from "./violation.ts";
import { Project } from "ts-morph";
import { applySuppressions } from "./suppression.ts";
import {
  type CentralizedObservabilityCallOptions,
  check as checkCentralizedObservabilityCall,
} from "./rules/centralized-observability-call.ts";
import { check as checkComponentFeatureImport } from "./rules/component-feature-import.ts";
import { check as checkFeatureBoundary } from "./rules/feature-boundary.ts";
import { check as checkFeatureSpecPairing } from "./rules/feature-spec-pairing.ts";
import { check as checkForbiddenLibrary } from "./rules/forbidden-library.ts";
import { check as checkForbiddenName } from "./rules/forbidden-name.ts";
import { check as checkIndexReExportOnly } from "./rules/index-re-export-only.ts";
import { check as checkLayerDependency } from "./rules/layer-dependency.ts";
import {
  type LoggingImplementationLocationOptions,
  check as checkLoggingImplementationLocation,
} from "./rules/logging-implementation-location.ts";
import { check as checkRepositoryAggregateRoot } from "./rules/repository-aggregate-root.ts";
import { check as checkStepDefinitionImport } from "./rules/step-definition-import.ts";
import { check as checkTestEachNotation } from "./rules/test-each-notation.ts";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * checker が対象にするディレクトリ（design §3 の monorepo 構成のうち、
 * アプリケーションコードが置かれる場所）。tools/ 自身・tests/policy/・
 * scripts/・docs/ は対象外（policy-as-test 等、別のゲートが担当する）。
 */
const DEFAULT_SCAN_DIRECTORIES = ["apps", "packages", "contract", "e2e"];

/**
 * OpenTelemetry の SDK 実装 + 既定 exporter（原則12「トレースの送り先」節）。
 * トランスポートやログ実装と異なり、この 2 つは「まだ選んでいない空スロット」
 * ではなく実際に採用済みの依存であるため、他のルール（transport / sdk /
 * logging-implementation）と違って既定値を空配列のままにしない。
 * 合成ルート（apps/api/src/composition.ts）だけがこれらを import してよい。
 */
const DEFAULT_RESTRICTED_SDK_MODULE_SPECIFIERS = [
  "@opentelemetry/sdk-node",
  "@opentelemetry/sdk-trace-base",
];

/**
 * `@opentelemetry/api` はベンダー中立の契約だが、業務コードから直接使わせず
 * trace 相関目的で観測境界（logging/）からのみ使わせる（理由: API 自体は
 * どこから呼んでも安全だが、呼び出し箇所を観測境界に絞ることで「span を開く/閉じる場所」
 * が canonical observer の 1 箇所であり続けることを構造的に保証できる。
 * 業務コードに解放すると、業務コードが独自に span を開始する経路が生まれ、
 * 「1 リクエスト = 1 ワイドイベント」と同じ境界で span を張るという
 * design §「送り先」の前提が崩れる）。
 */
const DEFAULT_LOGGING_IMPLEMENTATION_MODULE_SPECIFIERS = ["@opentelemetry/api"];

interface CheckerOptions {
  readonly scanDirectories?: readonly string[];
  readonly transportModuleSpecifiers?: readonly string[];
  readonly restrictedSdkModuleSpecifiers?: readonly string[];
  readonly loggingImplementationModuleSpecifiers?: readonly string[];
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    // ディレクトリ名違反など、そもそもファイルとして読めない対象は
    // 抑制コメントの対象になり得ないため、抑制なしとして扱う。
    return "";
  }
}

/**
 * ts-morph の `addSourceFilesAtPaths` は glob 一致のみでファイルを追加し、
 * `node_modules` を暗黙には除外しない。symlink（pnpm の workspace リンクや
 * 依存パッケージの実体リンク）も同様に辿って追加してしまうため、
 * 「packages/**」のような広い glob を使うと node_modules 配下の第三者
 * パッケージ（例: 生の .ts ソースを同梱する ajv・zod）や、node_modules 経由で
 * 到達した workspace パッケージ（symlink 先が scanDirectories 内でも、実体は
 * 別の glob 呼び出しで直接拾われるため二重になる）まで走査対象に入ってしまう
 * （実測: 2026-08-08、`apps/web/node_modules/{typescript,vitest,@amiceli}` の
 * symlink 経由で 774 件の node_modules ファイルが走査対象に混入していた）。
 *
 * 除外は `file-walk.ts`（ディレクトリ名ベースの生 fs 走査）とは別経路
 * （ts-morph 自身の glob 解決）で発生するため、同じ exclude 意図をここでも
 * 明示する必要がある。`!` 付き negated glob を同じ配列に渡すことで、
 * 直前の positive glob が一致させた node_modules 配下のパスを追加前に除外する
 * （symlink を辿った後の見かけ上のパスに `node_modules` セグメントが含まれる
 * 限り、実体が workspace 内かどうかに関わらず除外される）。
 */
function excludeNodeModulesGlob(absoluteDirectory: string): string {
  return `!${path.join(absoluteDirectory, "**/node_modules/**")}`;
}

function loadProject(rootDir: string, scanDirectories: readonly string[]): Project {
  const project = new Project({ skipAddingFilesFromTsConfig: true });

  for (const directoryName of scanDirectories) {
    const absoluteDirectory = path.join(rootDir, directoryName);
    if (!fs.existsSync(absoluteDirectory)) {
      continue;
    }
    project.addSourceFilesAtPaths([
      path.join(absoluteDirectory, "**/*.{ts,tsx}"),
      excludeNodeModulesGlob(absoluteDirectory),
    ]);
  }

  return project;
}

interface ResolvedRuleOptions {
  readonly transport: TransportClientLocationOptions;
  readonly sdk: ThirdPartySdkCompositionRootOptions;
  readonly logging: LoggingImplementationLocationOptions;
  readonly observability: CentralizedObservabilityCallOptions;
}

/**
 * 個別ルールの options 組み立てを 1 箇所にまとめる。runChecker 本体の
 * 文数（eslint max-statements）を抑えるための抽出であり、ロジックの分離
 * それ自体に意味は無い。observability は既定（"logging"）のまま使う。
 * CheckerOptions への配線は、observability 境界ディレクトリ名を
 * logging-implementation-location と独立に変える要求が出るまでは不要
 * （YAGNI）。型だけは明示し、knip の未使用 export 検出を素通りさせない
 * （原則7の「未使用検出をゼロに保つ」運用と同型）。
 */
function resolveRuleOptions(options: CheckerOptions): ResolvedRuleOptions {
  return {
    transport: { transportModuleSpecifiers: options.transportModuleSpecifiers ?? [] },
    sdk: { restrictedModuleSpecifiers: options.restrictedSdkModuleSpecifiers ?? [] },
    logging: {
      loggingImplementationModuleSpecifiers: options.loggingImplementationModuleSpecifiers ?? [],
    },
    observability: {},
  };
}

function runChecker(rootDir: string, options: CheckerOptions = {}): Violation[] {
  const scanDirectories = options.scanDirectories ?? DEFAULT_SCAN_DIRECTORIES;
  const scanRoots = scanDirectories.map((directoryName) => path.join(rootDir, directoryName));
  const project = loadProject(rootDir, scanDirectories);

  // .feature <-> spec の対応は Vitest + Gherkin レイヤ（use case/契約）の話。
  // e2e/ の .feature <-> step 定義の対応は bddgen（未定義/未使用 step の検出）
  // が別途担っており（design §4「機械強制」表）、対象が重複する。
  const featureSpecPairingScanRoots = scanRoots.filter((root) => path.basename(root) !== "e2e");
  const ruleOptions = resolveRuleOptions(options);

  const rawViolations: Violation[] = [
    ...checkLayerDependency(project),
    ...checkRepositoryAggregateRoot(project),
    ...checkFeatureBoundary(project),
    ...checkComponentFeatureImport(project),
    ...checkTransportClientLocation(project, ruleOptions.transport),
    ...checkForbiddenName(scanRoots),
    ...checkForbiddenLibrary(project),
    ...checkThirdPartySdkCompositionRoot(project, ruleOptions.sdk),
    ...checkLoggingImplementationLocation(project, ruleOptions.logging),
    ...checkCentralizedObservabilityCall(project, rootDir, ruleOptions.observability),
    ...checkIndexReExportOnly(project),
    ...checkTestEachNotation(project),
    ...checkFeatureSpecPairing(project, featureSpecPairingScanRoots),
    ...checkStepDefinitionImport(project),
  ];

  const { remaining, unreasonedSuppressions } = applySuppressions(rawViolations, readFile);
  return [...remaining, ...unreasonedSuppressions];
}

function main(): void {
  const [, _scriptPath, rootDirArgument] = process.argv;
  const rootDir = path.resolve(rootDirArgument ?? path.join(import.meta.dirname, "../../.."));

  const violations = runChecker(rootDir, {
    restrictedSdkModuleSpecifiers: DEFAULT_RESTRICTED_SDK_MODULE_SPECIFIERS,
    loggingImplementationModuleSpecifiers: DEFAULT_LOGGING_IMPLEMENTATION_MODULE_SPECIFIERS,
  });

  if (violations.length === 0) {
    console.log("architecture checker: 違反なし");
    return;
  }

  for (const violation of violations) {
    console.error(formatViolation(violation));
  }
  console.error(`architecture checker: ${violations.length} 件の違反`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  runChecker,
  DEFAULT_LOGGING_IMPLEMENTATION_MODULE_SPECIFIERS,
  DEFAULT_RESTRICTED_SDK_MODULE_SPECIFIERS,
};
export type { CheckerOptions };
