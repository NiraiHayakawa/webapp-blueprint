/**
 * 原則12「トレースの送り先」節の機械強制（design 実装タスクの「5.
 * architecture checker のルールを追加する」）。
 *
 * 新しいルールファイルは作らず、既存の 2 つの汎用ルールに実際の
 * OpenTelemetry パッケージ名を設定として渡す（third-party-sdk-composition-root
 * が sdk-node/sdk-trace-base を合成ルートに閉じ、logging-implementation-location
 * が api を logging/ 境界に閉じる。原則8「検査ロジックの二重管理を禁止」に
 * 従い、同じ制約の形をもう一度実装しない）。
 */
import {
  RULE_ID as THIRD_PARTY_SDK_COMPOSITION_ROOT_RULE_ID,
  check as checkThirdPartySdkCompositionRoot,
} from "../src/rules/third-party-sdk-composition-root.ts";
import {
  RULE_ID as LOGGING_IMPLEMENTATION_LOCATION_RULE_ID,
  check as checkLoggingImplementationLocation,
} from "../src/rules/logging-implementation-location.ts";
import {
  DEFAULT_LOGGING_IMPLEMENTATION_MODULE_SPECIFIERS,
  DEFAULT_RESTRICTED_SDK_MODULE_SPECIFIERS,
  runChecker,
} from "../src/checker.ts";
import { describe, it } from "node:test";
import { fixturePath, loadProject } from "./fixture-loading.ts";
import assert from "node:assert/strict";
import path from "node:path";

void describe("OpenTelemetry: sdk-node / 既定 exporter は合成ルートのみ", () => {
  void it("composition.ts での import は違反なし", () => {
    const project = loadProject(fixturePath("opentelemetry-boundaries", "allowed"));
    const violations = checkThirdPartySdkCompositionRoot(project, {
      restrictedModuleSpecifiers: DEFAULT_RESTRICTED_SDK_MODULE_SPECIFIERS,
    });
    assert.deepEqual(violations, []);
  });

  void it("composition.ts 以外（infrastructure）での import は違反になる", () => {
    const project = loadProject(fixturePath("opentelemetry-boundaries", "forbidden"));
    const violations = checkThirdPartySdkCompositionRoot(project, {
      restrictedModuleSpecifiers: DEFAULT_RESTRICTED_SDK_MODULE_SPECIFIERS,
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, THIRD_PARTY_SDK_COMPOSITION_ROOT_RULE_ID);
  });
});

void describe("OpenTelemetry: @opentelemetry/api は logging/ 境界からのみ", () => {
  void it("logging/ 配下での import は違反なし", () => {
    const project = loadProject(fixturePath("opentelemetry-boundaries", "allowed"));
    const violations = checkLoggingImplementationLocation(project, {
      loggingImplementationModuleSpecifiers: DEFAULT_LOGGING_IMPLEMENTATION_MODULE_SPECIFIERS,
    });
    assert.deepEqual(violations, []);
  });

  void it("logging/ の外（application）での import は違反になる", () => {
    const project = loadProject(fixturePath("opentelemetry-boundaries", "forbidden"));
    const violations = checkLoggingImplementationLocation(project, {
      loggingImplementationModuleSpecifiers: DEFAULT_LOGGING_IMPLEMENTATION_MODULE_SPECIFIERS,
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, LOGGING_IMPLEMENTATION_LOCATION_RULE_ID);
  });
});

void describe("OpenTelemetry: 実リポジトリへの適用（main() と同じ既定値）", () => {
  void it("実際の checker 実行(mise run check:architecture と同じ options)は違反ゼロになる", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    const violations = runChecker(repoRoot, {
      restrictedSdkModuleSpecifiers: DEFAULT_RESTRICTED_SDK_MODULE_SPECIFIERS,
      loggingImplementationModuleSpecifiers: DEFAULT_LOGGING_IMPLEMENTATION_MODULE_SPECIFIERS,
    });
    assert.deepEqual(violations, []);
  });
});
