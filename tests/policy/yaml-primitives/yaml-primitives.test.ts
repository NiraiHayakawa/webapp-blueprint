import { describe, expect, it, vi } from "vitest";

import { indentOf, stripQuotes } from "./yaml-primitives.ts";

vi.setConfig({ testTimeout: 5000 });

const FOUR_SPACE_INDENT = 4;

describe(indentOf, () => {
  it("先頭の半角スペースの数を返す", () => {
    expect.hasAssertions();
    expect(indentOf("    key: value")).toBe(FOUR_SPACE_INDENT);
  });

  it("インデントが無ければ 0", () => {
    expect.hasAssertions();
    expect(indentOf("key: value")).toBe(0);
  });
});

describe(stripQuotes, () => {
  it("ダブルクォートを剥がす", () => {
    expect.hasAssertions();
    expect(stripQuotes('"op://vault/item/field"')).toBe("op://vault/item/field");
  });

  it("シングルクォートを剥がす", () => {
    expect.hasAssertions();
    expect(stripQuotes("'catalog:'")).toBe("catalog:");
  });

  it("クォートが無ければそのまま返す（前後の空白は削る）", () => {
    expect.hasAssertions();
    expect(stripQuotes("  build  ")).toBe("build");
  });
});
