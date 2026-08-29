import { describe, expect, it } from "vitest";

describe("TaskTitle", () => {
  it.each([
    { input: "", valid: false },
    { input: "買い物リストを作る", valid: true },
  ])("入力が $input のとき valid は $valid になる", ({ input, valid }) => {
    expect(input.length > 0).toBe(valid);
  });
});
