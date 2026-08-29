import { describe, expect, it, vi } from "vitest";
import { AppException } from "./app-exception.js";
import type { FailureReason } from "./failure-reason.js";
import { toApiErrorResponse } from "./api-error-response.js";

vi.setConfig({ testTimeout: 5000 });

describe(toApiErrorResponse, () => {
  it.each([
    { logDetails: { attempts: 3 } },
    { logDetails: { rawErrorName: "TaskTitleEmptyError" } },
  ])(
    "logDetails が $logDetails でも応答オブジェクトに logDetails キーは現れない",
    ({ logDetails }) => {
      expect.hasAssertions();
      const appException = new AppException({
        code: "SOME_CODE",
        statusCode: 400,
        reasons: new Set<FailureReason>(["invalid-input"]),
        details: { field: "title" },
        logDetails,
      });

      const response = toApiErrorResponse(appException);

      expect(response).not.toHaveProperty("logDetails");
      expect(response).toStrictEqual({
        code: "SOME_CODE",
        statusCode: 400,
        details: { field: "title" },
      });
    },
  );
});
