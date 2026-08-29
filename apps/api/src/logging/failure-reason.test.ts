import { describe, expect, it, vi } from "vitest";
import { type FailureReason, deriveLevel, deriveRetryScope } from "./failure-reason.js";

vi.setConfig({ testTimeout: 5000 });

/**
 * 純粋な計算規則（外部境界を持たない）。§4「テスト戦略」の判定基準どおり
 * table-driven（object table + `$field` 補間）で書き、Gherkin は使わない。
 */
/**
 * `it.each<T>` に型引数を渡して table の要素を文脈から型付ける。
 * `as FailureReason[]` を書かずに済ませるための形で、table を外の const へ
 * 追い出すのとは違い、tools/architecture の test-each-notation が
 * 「配列リテラルであること」を見て検査し続けられる（変数参照にすると
 * 静的に判定できず、検査が黙って素通りする）。
 */
interface RetryScopeCase {
  readonly reasons: readonly FailureReason[];
  readonly expectedScope: "none" | "retryable";
}

interface LevelCase {
  readonly reasons: readonly FailureReason[];
  readonly expectedLevel: "warn" | "error";
}

describe(deriveRetryScope, () => {
  it.each<RetryScopeCase>([
    { reasons: ["invalid-input"], expectedScope: "none" },
    { reasons: ["storage-unavailable"], expectedScope: "retryable" },
    { reasons: ["retry-exhausted"], expectedScope: "none" },
    {
      reasons: ["storage-unavailable", "retry-exhausted"],
      expectedScope: "none",
    },
  ])(
    "reasons が $reasons のとき retryScope は $expectedScope になる",
    ({ reasons, expectedScope }) => {
      expect.hasAssertions();
      expect(deriveRetryScope(new Set(reasons))).toBe(expectedScope);
    },
  );

  it("retryable な理由に retry-exhausted を合成すると none に転じる", () => {
    expect.hasAssertions();
    expect(deriveRetryScope(new Set<FailureReason>(["storage-unavailable"]))).toBe("retryable");
    expect(
      deriveRetryScope(new Set<FailureReason>(["storage-unavailable", "retry-exhausted"])),
    ).toBe("none");
  });
});

describe(deriveLevel, () => {
  it.each<LevelCase>([
    { reasons: ["invalid-input"], expectedLevel: "error" },
    { reasons: ["storage-unavailable"], expectedLevel: "warn" },
    {
      reasons: ["storage-unavailable", "retry-exhausted"],
      expectedLevel: "error",
    },
  ])(
    "reasons が $reasons のとき level は $expectedLevel になる（書き手は選ばない）",
    ({ reasons, expectedLevel }) => {
      expect.hasAssertions();
      expect(deriveLevel(new Set(reasons))).toBe(expectedLevel);
    },
  );
});
