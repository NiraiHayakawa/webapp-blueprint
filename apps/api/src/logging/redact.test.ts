import { describe, expect, it, vi } from "vitest";
import { assertNoForbiddenFields, ForbiddenLogFieldError } from "./redact.js";

vi.setConfig({ testTimeout: 5000 });

describe(assertNoForbiddenFields, () => {
  it.each([
    { fieldName: "authToken" },
    { fieldName: "Authorization" },
    { fieldName: "api_key" },
    { fieldName: "userCookie" },
    { fieldName: "signedUrl" },
  ])("フィールド名が $fieldName のとき ForbiddenLogFieldError を throw する", ({ fieldName }) => {
    expect.hasAssertions();
    const fields = { [fieldName]: "value" };
    expect(() => {
      assertNoForbiddenFields(fields);
    }).toThrow(ForbiddenLogFieldError);
  });

  it.each([{ fieldName: "resource" }, { fieldName: "attempts" }, { fieldName: "field" }])(
    "フィールド名が $fieldName のときは throw しない",
    ({ fieldName }) => {
      expect.hasAssertions();
      const fields = { [fieldName]: "value" };
      expect(() => {
        assertNoForbiddenFields(fields);
      }).not.toThrow();
    },
  );
});
