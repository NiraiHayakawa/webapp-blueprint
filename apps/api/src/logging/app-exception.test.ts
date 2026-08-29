import { describe, expect, it, vi } from "vitest";
import { AppException } from "./app-exception.js";
import { EmptyFailureReasonSetError } from "./empty-failure-reason-set.error.js";
import type { FailureReason } from "./failure-reason.js";

vi.setConfig({ testTimeout: 5000 });

describe("appException", () => {
  it("reasons が空集合だと EmptyFailureReasonSetError を throw する", () => {
    expect.hasAssertions();
    expect(
      () =>
        new AppException({
          code: "SOME_CODE",
          statusCode: 500,
          reasons: new Set<FailureReason>(),
          details: {},
          logDetails: {},
        }),
    ).toThrow(EmptyFailureReasonSetError);
  });

  it("details と logDetails をそれぞれ別のフィールドとして保持する", () => {
    expect.hasAssertions();
    const appException = new AppException({
      code: "TASK_TITLE_EMPTY",
      statusCode: 400,
      reasons: new Set<FailureReason>(["invalid-input"]),
      details: { field: "title" },
      logDetails: { rawErrorName: "TaskTitleEmptyError" },
    });

    expect(appException.details).toStrictEqual({ field: "title" });
    expect(appException.logDetails).toStrictEqual({ rawErrorName: "TaskTitleEmptyError" });
  });
});
