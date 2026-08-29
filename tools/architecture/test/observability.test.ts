/**
 * 観測性の機械強制（原則12「観測可能性は設計に組み込む」/
 * docs/plan/Template/20260807_template-design.md「観測性の機械強制」）
 * に関するルール群の fixture テスト。checker.test.ts への追記ではなく
 * 新規ファイルとして分離する（原則7「拡張はファイルの追加で表現される」/
 * 既存ファイルの行数純増は分割サイン。実測: checker.test.ts への追記は
 * codopsy の max-lines 閾値(300行)を超過し `mise run check:complexity` を
 * 落とした）。
 */
import {
  RULE_ID as CENTRALIZED_OBSERVABILITY_CALL_RULE_ID,
  check as checkCentralizedObservabilityCall,
} from "../src/rules/centralized-observability-call.ts";
import {
  RULE_ID as LOGGING_IMPLEMENTATION_LOCATION_RULE_ID,
  check as checkLoggingImplementationLocation,
} from "../src/rules/logging-implementation-location.ts";
import { describe, it } from "node:test";
import { fixturePath, loadProject } from "./fixture-loading.ts";
import assert from "node:assert/strict";

void describe("logging-implementation-location", () => {
  void it("logging 配下での logging 実装 import は違反なし", () => {
    const project = loadProject(fixturePath("logging-implementation-location", "allowed"));
    const violations = checkLoggingImplementationLocation(project, {
      loggingImplementationModuleSpecifiers: ["@fixtures/logging-sdk"],
    });
    assert.deepEqual(violations, []);
  });

  void it("logging 以外での logging 実装 import は違反になる", () => {
    const project = loadProject(fixturePath("logging-implementation-location", "forbidden"));
    const violations = checkLoggingImplementationLocation(project, {
      loggingImplementationModuleSpecifiers: ["@fixtures/logging-sdk"],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, LOGGING_IMPLEMENTATION_LOCATION_RULE_ID);
  });

  void it("loggingImplementationModuleSpecifiers が空（ログ実装未選択の既定値）なら常に違反なし", () => {
    const project = loadProject(fixturePath("logging-implementation-location", "forbidden"));
    const violations = checkLoggingImplementationLocation(project, {
      loggingImplementationModuleSpecifiers: [],
    });
    assert.deepEqual(violations, []);
  });
});

void describe("centralized-observability-call", () => {
  void it("logging 配下での console.* 呼び出しは違反なし（観測ヘルパー実装自身）", () => {
    const rootDir = fixturePath("centralized-observability-call", "allowed");
    const project = loadProject(rootDir);
    assert.deepEqual(checkCentralizedObservabilityCall(project, rootDir), []);
  });

  void it("業務コードでの console.* 直接呼び出しは違反になる", () => {
    const rootDir = fixturePath("centralized-observability-call", "forbidden");
    const project = loadProject(rootDir);
    const violations = checkCentralizedObservabilityCall(project, rootDir);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, CENTRALIZED_OBSERVABILITY_CALL_RULE_ID);
    assert.match(violations[0]?.hint ?? "", /console\.log/u);
  });

  void it("rootDir 直下が e2e（CLI ツールディレクトリ）なら console.* 直接呼び出しも違反なし", () => {
    const rootDir = fixturePath("centralized-observability-call", "e2e-excluded");
    const project = loadProject(rootDir);
    assert.deepEqual(checkCentralizedObservabilityCall(project, rootDir), []);
  });
});
