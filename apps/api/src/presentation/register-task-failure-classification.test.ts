import { describe, expect, it, vi } from "vitest";
import { TaskTitle } from "../domain/task/task-title.js";
import { TaskTitleEmptyError } from "../domain/task/task-title-empty.error.js";
import { TaskTitleTooLongError } from "../domain/task/task-title-too-long.error.js";
import { TaskRepositoryUnavailableError } from "../application/register-task/task-repository-unavailable.error.js";
import { classifyRegisterTaskFailure } from "./register-task-failure-classification.js";

vi.setConfig({ testTimeout: 5000 });

const SAMPLE_ATTEMPTS = 3;

describe(classifyRegisterTaskFailure, () => {
  it.each([
    {
      error: new TaskTitleEmptyError(),
      expectedCode: "TASK_TITLE_EMPTY",
      expectedReasons: ["invalid-input"],
    },
    {
      error: new TaskTitleTooLongError(TaskTitle.maxLength),
      expectedCode: "TASK_TITLE_TOO_LONG",
      expectedReasons: ["invalid-input"],
    },
    {
      error: new TaskRepositoryUnavailableError({ attempts: SAMPLE_ATTEMPTS }),
      expectedCode: "TASK_STORAGE_UNAVAILABLE",
      expectedReasons: ["storage-unavailable", "retry-exhausted"],
    },
  ])("$expectedCode に分類される", ({ error, expectedCode, expectedReasons }) => {
    expect.hasAssertions();
    const appException = classifyRegisterTaskFailure(error);

    expect(appException.code).toBe(expectedCode);
    expect([...appException.reasons].toSorted()).toStrictEqual(expectedReasons.toSorted());
  });

  it("分類できない例外はそのまま rethrow する（fail-fast: 未知の失敗を丸めない）", () => {
    expect.hasAssertions();
    const unknownError = new Error("boom");

    expect(() => classifyRegisterTaskFailure(unknownError)).toThrow(unknownError);
  });

  it("logDetails には details と異なる server-only の情報を積める", () => {
    expect.hasAssertions();
    const appException = classifyRegisterTaskFailure(
      new TaskRepositoryUnavailableError({ attempts: SAMPLE_ATTEMPTS }),
    );

    expect(appException.logDetails["attempts"]).toBe(SAMPLE_ATTEMPTS);
    expect(appException.details).not.toHaveProperty("attempts");
  });
});
