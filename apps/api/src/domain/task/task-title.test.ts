import { describe, expect, it, vi } from "vitest";

import { TaskTitle } from "./task-title.js";
import { TaskTitleEmptyError } from "./task-title-empty.error.js";
import { TaskTitleTooLongError } from "./task-title-too-long.error.js";

vi.setConfig({ testTimeout: 5000 });

/**
 * Table-driven（object table + `$field` 補間）。
 * tuple 形式の it.each は使わない（docs/plan/Template/20260807_template-design.md §5「architecture checker」）。
 */
describe("taskTitle.create", () => {
  it.each([
    { rawValue: "買い物リストを作る", expectedValue: "買い物リストを作る" },
    { rawValue: "  先頭と末尾に空白がある  ", expectedValue: "先頭と末尾に空白がある" },
    {
      rawValue: "a".repeat(TaskTitle.maxLength),
      expectedValue: "a".repeat(TaskTitle.maxLength),
    },
  ])(
    "rawValue が「$rawValue」のとき value は「$expectedValue」になる",
    ({ rawValue, expectedValue }) => {
      expect.hasAssertions();
      expect(TaskTitle.create(rawValue).value).toBe(expectedValue);
    },
  );

  it.each([
    { rawValue: "", errorName: "TaskTitleEmptyError", errorType: TaskTitleEmptyError },
    { rawValue: "   ", errorName: "TaskTitleEmptyError", errorType: TaskTitleEmptyError },
    {
      rawValue: "a".repeat(TaskTitle.maxLength + 1),
      errorName: "TaskTitleTooLongError",
      errorType: TaskTitleTooLongError,
    },
  ])("rawValue が「$rawValue」のとき $errorName を throw する", ({ rawValue, errorType }) => {
    expect.hasAssertions();
    expect(() => TaskTitle.create(rawValue)).toThrow(errorType);
  });
});
