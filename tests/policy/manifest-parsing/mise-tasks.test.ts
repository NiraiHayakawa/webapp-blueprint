import { describe, expect, it, vi } from "vitest";

import { extractTaskDepends } from "./mise-tasks.ts";

vi.setConfig({ testTimeout: 5000 });

const MULTILINE_DEPENDS_TOML = [
  "[tasks.check]",
  'description = "全ゲートの入口"',
  "depends = [",
  '  "lint",',
  '  "fmt",',
  '  "test:policy",',
  "]",
  "",
  '[tasks."check:workflows"]',
  'run = "actionlint"',
].join("\n");

const INLINE_DEPENDS_TOML = ["[tasks.check]", 'depends = ["lint", "fmt"]'].join("\n");

describe(extractTaskDepends, () => {
  it("複数行のブロック配列から depends の要素を取り出す", () => {
    expect.hasAssertions();
    expect(extractTaskDepends(MULTILINE_DEPENDS_TOML, "check")).toStrictEqual([
      "lint",
      "fmt",
      "test:policy",
    ]);
  });

  it("インラインのフローリストから depends の要素を取り出す", () => {
    expect.hasAssertions();
    expect(extractTaskDepends(INLINE_DEPENDS_TOML, "check")).toStrictEqual(["lint", "fmt"]);
  });

  it("[tasks.check] セクションが無ければ空配列を返す", () => {
    expect.hasAssertions();
    expect(extractTaskDepends('[tasks.lint]\nrun = "oxlint ."\n', "check")).toStrictEqual([]);
  });

  it("引用符付きのセクション名（`:` を含むタスク）も引用符なしのタスク名で引ける", () => {
    expect.hasAssertions();
    const toml = [
      "[tasks.check]",
      'depends = ["lint"]',
      "",
      '[tasks."mcp:ramune"]',
      'depends = ["install"]',
    ].join("\n");
    expect(extractTaskDepends(toml, "mcp:ramune")).toStrictEqual(["install"]);
  });

  it("[tasks.check] の次のセクションにある depends は拾わない（セクション境界の検証）", () => {
    expect.hasAssertions();
    const toml = [
      "[tasks.check]",
      'description = "no depends here"',
      "",
      '[tasks."check:other"]',
      "depends = [",
      '  "should-not-be-picked-up",',
      "]",
    ].join("\n");
    expect(extractTaskDepends(toml, "check")).toStrictEqual([]);
  });
});
