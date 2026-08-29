import { describe, expect, it } from "vitest";

describe("TaskTitle", () => {
  // タプル形式（配列の配列）は禁止。object table 形式にすること。
  it.each([
    ["", false],
    ["買い物リストを作る", true],
  ])("入力が %s のとき valid は %s になる", (input, valid) => {
    expect(input.length > 0).toBe(valid);
  });
});
