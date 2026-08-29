import { ROOT_AGENTS_MD_LINE_LIMIT, checkLineLimit, countLines } from "./context-budget.check.ts";
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

vi.setConfig({ testTimeout: 5000 });

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const FIXTURE_LINE_LIMIT = 5;
const OVER_LIMIT_LINE_COUNT = 10;
const FIXTURE_TEXT_LINE_COUNT = 3;

describe("context-budget: fixture(自己完結)", () => {
  it("上限以下の行数は違反ゼロ", () => {
    expect.hasAssertions();
    const text = ["a", "b", "c"].join("\n");
    expect(countLines(text)).toBe(FIXTURE_TEXT_LINE_COUNT);
    expect(checkLineLimit("fixture", text, FIXTURE_LINE_LIMIT)).toStrictEqual([]);
  });

  it("上限を超える行数は違反になる", () => {
    expect.hasAssertions();
    const text = Array.from(
      { length: OVER_LIMIT_LINE_COUNT },
      (_unused, lineNumber) => `line ${lineNumber}`,
    ).join("\n");
    const violations = checkLineLimit("fixture", text, FIXTURE_LINE_LIMIT);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain(`${OVER_LIMIT_LINE_COUNT} 行`);
  });

  it("末尾の改行 1 個は行数に数えない", () => {
    expect.hasAssertions();
    expect(countLines("a\nb\nc\n")).toBe(FIXTURE_TEXT_LINE_COUNT);
    expect(countLines("a\nb\nc")).toBe(FIXTURE_TEXT_LINE_COUNT);
  });
});

describe("context-budget: 実リポジトリ(ルート AGENTS.md)", () => {
  const agentsMdPath = path.join(REPO_ROOT, "AGENTS.md");

  it("ルート AGENTS.md が存在する(受入条件1)", () => {
    expect.hasAssertions();
    expect(existsSync(agentsMdPath)).toBe(true);
  });

  it(`ルート AGENTS.md が ${ROOT_AGENTS_MD_LINE_LIMIT} 行を超えていない(受入条件17)`, () => {
    expect.hasAssertions();
    if (!existsSync(agentsMdPath)) {
      throw new Error("AGENTS.md が存在しないため行数を検証できない");
    }
    const text = readFileSync(agentsMdPath, "utf-8");
    expect(checkLineLimit(agentsMdPath, text, ROOT_AGENTS_MD_LINE_LIMIT)).toStrictEqual([]);
  });
});
