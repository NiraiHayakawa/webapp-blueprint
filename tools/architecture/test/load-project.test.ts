import { RULE_ID as INDEX_RE_EXPORT_ONLY_RULE_ID } from "../src/rules/index-re-export-only.ts";
import { describe, it } from "node:test";
import { fixturePath } from "./fixture-loading.ts";
import assert from "node:assert/strict";
import { runChecker } from "../src/checker.ts";

// checker.test.ts から切り出している（原則7「拡張はファイルの追加で表現される。
// 既存ファイルの行数純増は分割サイン」。checker.test.ts が eslint/max-lines の
// 閾値 300 行を超えたため、このテストケース単体を新規ファイルに切り出した）。
void describe("loadProject（node_modules 配下は走査対象外）", () => {
  void it("node_modules 配下のファイルは symlink 経由（pnpm workspace リンク）でも走査対象に入らない", () => {
    const violations = runChecker(fixturePath("node-modules-exclusion"), {
      scanDirectories: ["packages"],
    });
    // 期待される違反は packages/real-pkg/index.ts の 1 件だけ:
    // - packages/app/node_modules/vendor/index.ts（素の node_modules 配下、
    //   ajv/zod のように .ts ソースを同梱する第三者パッケージを模したもの）
    // - packages/app/node_modules/real-pkg（symlink。実体は packages/real-pkg と同じ
    //   だが node_modules を経由して到達する pnpm workspace リンクを模したもの）
    // のどちらも数えられていないこと、かつ node_modules を経由しない正規のファイルは
    // 引き続き検出されることを 1 つの assertion で確認する。
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.ruleId, INDEX_RE_EXPORT_ONLY_RULE_ID);
    assert.match(violations[0]?.filePath ?? "", /packages\/real-pkg\/index\.ts$/u);
  });
});
