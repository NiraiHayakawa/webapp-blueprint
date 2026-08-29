import {
  RULE_ID as COMPONENT_FEATURE_IMPORT_RULE_ID,
  check as checkComponentFeatureImport,
} from "../src/rules/component-feature-import.ts";
import {
  RULE_ID as FEATURE_BOUNDARY_RULE_ID,
  check as checkFeatureBoundary,
} from "../src/rules/feature-boundary.ts";
import {
  RULE_ID as FEATURE_SPEC_PAIRING_RULE_ID,
  check as checkFeatureSpecPairing,
} from "../src/rules/feature-spec-pairing.ts";
import {
  RULE_ID as FORBIDDEN_LIBRARY_RULE_ID,
  check as checkForbiddenLibrary,
} from "../src/rules/forbidden-library.ts";
import {
  RULE_ID as FORBIDDEN_NAME_RULE_ID,
  check as checkForbiddenName,
} from "../src/rules/forbidden-name.ts";
import {
  RULE_ID as INDEX_RE_EXPORT_ONLY_RULE_ID,
  check as checkIndexReExportOnly,
} from "../src/rules/index-re-export-only.ts";
import {
  RULE_ID as LAYER_DEPENDENCY_RULE_ID,
  check as checkLayerDependency,
} from "../src/rules/layer-dependency.ts";
import {
  RULE_ID as REPOSITORY_AGGREGATE_ROOT_RULE_ID,
  check as checkRepositoryAggregateRoot,
} from "../src/rules/repository-aggregate-root.ts";
import {
  RULE_ID as STEP_DEFINITION_IMPORT_RULE_ID,
  check as checkStepDefinitionImport,
} from "../src/rules/step-definition-import.ts";
import {
  RULE_ID as TEST_EACH_NOTATION_RULE_ID,
  check as checkTestEachNotation,
} from "../src/rules/test-each-notation.ts";
import {
  RULE_ID as THIRD_PARTY_SDK_COMPOSITION_ROOT_RULE_ID,
  check as checkThirdPartySdkCompositionRoot,
} from "../src/rules/third-party-sdk-composition-root.ts";
import {
  RULE_ID as TRANSPORT_CLIENT_LOCATION_RULE_ID,
  check as checkTransportClientLocation,
} from "../src/rules/transport-client-location.ts";
import { describe, it } from "node:test";
import { fixturePath, loadProject, readFile } from "./fixture-loading.ts";
import { applySuppressions } from "../src/suppression.ts";
import assert from "node:assert/strict";
import { runChecker } from "../src/checker.ts";

void describe("layer-dependency", () => {
  void it("レイヤの一方通行 + domain の外部 import ゼロを満たす構成は違反なし", () => {
    const project = loadProject(fixturePath("layer-dependency", "allowed"));
    assert.deepEqual(checkLayerDependency(project), []);
  });

  void it("domain が外部パッケージを import すると違反になる", () => {
    const project = loadProject(fixturePath("layer-dependency", "forbidden-domain-external"));
    const violations = checkLayerDependency(project);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, LAYER_DEPENDENCY_RULE_ID);
    assert.match(violations[0]?.hint ?? "", /外部パッケージ/u);
  });

  void it("domain が application を import すると依存方向違反になる", () => {
    const project = loadProject(fixturePath("layer-dependency", "forbidden-domain-outward"));
    const violations = checkLayerDependency(project);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, LAYER_DEPENDENCY_RULE_ID);
    assert.match(violations[0]?.hint ?? "", /依存方向/u);
  });
});

void describe("repository-aggregate-root", () => {
  void it("aggregate root（Order）に付いた repository は違反なし", () => {
    const project = loadProject(fixturePath("repository-aggregate-root", "allowed"));
    assert.deepEqual(checkRepositoryAggregateRoot(project), []);
  });

  void it("非 root（OrderLine）に付いた repository は違反になる", () => {
    const project = loadProject(fixturePath("repository-aggregate-root", "forbidden"));
    const violations = checkRepositoryAggregateRoot(project);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, REPOSITORY_AGGREGATE_ROOT_RULE_ID);
    assert.match(violations[0]?.hint ?? "", /OrderLine/u);
  });
});

void describe("feature-boundary", () => {
  void it("子孫・兄弟への公開面 import、外からの top-level feature 参照は違反なし", () => {
    const project = loadProject(fixturePath("feature-boundary", "allowed"));
    assert.deepEqual(checkFeatureBoundary(project), []);
  });

  void it("子 feature から親 feature への import は違反になる", () => {
    const project = loadProject(fixturePath("feature-boundary", "forbidden"));
    const violations = checkFeatureBoundary(project);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, FEATURE_BOUNDARY_RULE_ID);
    assert.match(violations[0]?.hint ?? "", /親 feature/u);
  });
});

void describe("component-feature-import", () => {
  void it("feature から components への import は違反なし", () => {
    const project = loadProject(fixturePath("component-feature-import", "allowed"));
    assert.deepEqual(checkComponentFeatureImport(project), []);
  });

  void it("components から features への import は違反になる", () => {
    const project = loadProject(fixturePath("component-feature-import", "forbidden"));
    const violations = checkComponentFeatureImport(project);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, COMPONENT_FEATURE_IMPORT_RULE_ID);
  });
});

void describe("transport-client-location", () => {
  void it("lib/transport 配下での client 生成は違反なし", () => {
    const project = loadProject(fixturePath("transport-client-location", "allowed"));
    const violations = checkTransportClientLocation(project, {
      transportModuleSpecifiers: ["@fixtures/transport-sdk"],
    });
    assert.deepEqual(violations, []);
  });

  void it("lib/transport 以外での client 生成は違反になる", () => {
    const project = loadProject(fixturePath("transport-client-location", "forbidden"));
    const violations = checkTransportClientLocation(project, {
      transportModuleSpecifiers: ["@fixtures/transport-sdk"],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, TRANSPORT_CLIENT_LOCATION_RULE_ID);
  });

  void it("transportModuleSpecifiers が空（契約層未選択の既定値）なら常に違反なし", () => {
    const project = loadProject(fixturePath("transport-client-location", "forbidden"));
    const violations = checkTransportClientLocation(project, { transportModuleSpecifiers: [] });
    assert.deepEqual(violations, []);
  });
});

void describe("forbidden-name", () => {
  void it("吹き溜まり名を含まない構成は違反なし", () => {
    const violations = checkForbiddenName([fixturePath("forbidden-name", "allowed")]);
    assert.deepEqual(violations, []);
  });

  void it("utils ディレクトリは違反になる", () => {
    const violations = checkForbiddenName([fixturePath("forbidden-name", "forbidden")]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, FORBIDDEN_NAME_RULE_ID);
    assert.match(violations[0]?.hint ?? "", /utils/u);
  });
});

void describe("forbidden-library", () => {
  void it("禁止ライブラリを import しない構成は違反なし", () => {
    const project = loadProject(fixturePath("forbidden-library", "allowed"));
    assert.deepEqual(checkForbiddenLibrary(project), []);
  });

  void it("neverthrow の import は違反になる", () => {
    const project = loadProject(fixturePath("forbidden-library", "forbidden"));
    const violations = checkForbiddenLibrary(project);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, FORBIDDEN_LIBRARY_RULE_ID);
    assert.match(violations[0]?.hint ?? "", /neverthrow/u);
  });
});

void describe("third-party-sdk-composition-root", () => {
  void it("application/composition.ts での SDK import は違反なし", () => {
    const project = loadProject(fixturePath("third-party-sdk-composition-root", "allowed"));
    const violations = checkThirdPartySdkCompositionRoot(project, {
      restrictedModuleSpecifiers: ["@fixtures/payment-sdk"],
    });
    assert.deepEqual(violations, []);
  });

  void it("infrastructure での直接 SDK import は違反になる", () => {
    const project = loadProject(fixturePath("third-party-sdk-composition-root", "forbidden"));
    const violations = checkThirdPartySdkCompositionRoot(project, {
      restrictedModuleSpecifiers: ["@fixtures/payment-sdk"],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, THIRD_PARTY_SDK_COMPOSITION_ROOT_RULE_ID);
  });
});

void describe("index-re-export-only", () => {
  void it("re-export のみの feature index は違反なし", () => {
    const project = loadProject(fixturePath("index-re-export-only", "allowed"));
    assert.deepEqual(checkIndexReExportOnly(project), []);
  });

  void it("直接宣言を持つ feature index は違反になる", () => {
    const project = loadProject(fixturePath("index-re-export-only", "forbidden"));
    const violations = checkIndexReExportOnly(project);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, INDEX_RE_EXPORT_ONLY_RULE_ID);
  });
});

void describe("test-each-notation", () => {
  void it("object table 形式 + $field 補間は違反なし", () => {
    const project = loadProject(fixturePath("test-each-notation", "allowed"));
    assert.deepEqual(checkTestEachNotation(project), []);
  });

  void it("タプル形式の it.each は違反になる", () => {
    const project = loadProject(fixturePath("test-each-notation", "forbidden"));
    const violations = checkTestEachNotation(project);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, TEST_EACH_NOTATION_RULE_ID);
    assert.match(violations[0]?.hint ?? "", /タプル/u);
  });
});

void describe("feature-spec-pairing", () => {
  void it(".feature と spec が対応していれば違反なし", () => {
    const project = loadProject(fixturePath("feature-spec-pairing", "allowed"));
    const violations = checkFeatureSpecPairing(project, [
      fixturePath("feature-spec-pairing", "allowed"),
    ]);
    assert.deepEqual(violations, []);
  });

  void it(".feature だけが存在し spec が無いと違反になる", () => {
    const project = loadProject(fixturePath("feature-spec-pairing", "forbidden"));
    const violations = checkFeatureSpecPairing(project, [
      fixturePath("feature-spec-pairing", "forbidden"),
    ]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, FEATURE_SPEC_PAIRING_RULE_ID);
  });
});

void describe("step-definition-import", () => {
  void it("step 定義から公開エントリポイント（index）への import は違反なし", () => {
    const project = loadProject(fixturePath("step-definition-import", "allowed"));
    assert.deepEqual(checkStepDefinitionImport(project), []);
  });

  void it("step 定義から内部ファイルへの直接 import は違反になる", () => {
    const project = loadProject(fixturePath("step-definition-import", "forbidden"));
    const violations = checkStepDefinitionImport(project);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, STEP_DEFINITION_IMPORT_RULE_ID);
  });
});

void describe("runChecker（全ルール + 抑制処理を束ねた統合経路）", () => {
  void it("正しい構成に対しては全ルールを通しても違反なし", () => {
    const violations = runChecker(fixturePath("layer-dependency"), {
      scanDirectories: ["allowed"],
    });
    assert.deepEqual(violations, []);
  });

  void it("違反のある構成に対しては suppression を経た後も違反が残る", () => {
    const violations = runChecker(fixturePath("layer-dependency"), {
      scanDirectories: ["forbidden-domain-outward"],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, LAYER_DEPENDENCY_RULE_ID);
  });
});

void describe("suppression（理由の無い抑制を検出して落とす）", () => {
  void it("理由付きの抑制コメントは違反を握りつぶす", () => {
    const project = loadProject(fixturePath("suppression", "allowed"));
    const rawViolations = checkForbiddenLibrary(project);
    // 抑制前は違反として検出されている
    assert.equal(rawViolations.length, 1);

    const { remaining, unreasonedSuppressions } = applySuppressions(rawViolations, readFile);
    assert.deepEqual(remaining, []);
    assert.deepEqual(unreasonedSuppressions, []);
  });

  void it("理由の無い抑制コメントは、抑制自体を新たな違反として報告する", () => {
    const project = loadProject(fixturePath("suppression", "forbidden"));
    const rawViolations = checkForbiddenLibrary(project);
    assert.equal(rawViolations.length, 1);

    const { remaining, unreasonedSuppressions } = applySuppressions(rawViolations, readFile);
    // 元の違反はもう出ない(抑制は成立している)
    assert.deepEqual(remaining, []);
    assert.equal(unreasonedSuppressions.length, 1);
    assert.equal(unreasonedSuppressions[0]?.ruleId, "suppression-without-reason");
  });
});
