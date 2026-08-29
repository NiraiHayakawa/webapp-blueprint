import { describe, expect, it, vi } from "vitest";

import { renderGreetingMessage } from "./greeting-message.js";

vi.setConfig({ testTimeout: 5000 });

/**
 * Props-only な component のテスト（モック一切なし）。table-driven（object table +
 * `$field` 補間）。
 */
describe(renderGreetingMessage, () => {
  it.each([
    {
      message: "こんにちは、ゲスト さん",
      expectedHtml: '<p class="greeting-message">こんにちは、ゲスト さん</p>',
    },
    {
      message: "<script>alert(1)</script>",
      expectedHtml: '<p class="greeting-message">&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    },
  ])("message が「$message」のとき $expectedHtml を返す", ({ message, expectedHtml }) => {
    expect.hasAssertions();
    expect(renderGreetingMessage({ message })).toBe(expectedHtml);
  });
});
