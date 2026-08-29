import {
  checkClosedVocabulary,
  checkComposedReasonCodes,
  extractUnionStringLiterals,
} from "./failure-reason-vocabulary.check.ts";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
// 閉じた語彙+合成可能性を実装する失敗理由コード
// (§9「最小の縦切り」)。design-report が空スロットとして扱っていた
// エラーコード体系は、このテストを書いている時点で並行セッションによって
// 実装が進行中だった(2026-08-09 に実測)。存在すれば実際の語彙に対して
// 検証し、無ければ「まだ空スロット」であることを明示的に検証する
// (原則11: 正本の鮮度。どちらの状態でも検査対象を持つ)。
const FAILURE_REASON_IMPLEMENTATION_PATH = path.join(
  REPO_ROOT,
  "apps/api/src/logging/failure-reason.ts",
);

// 閉じた語彙（Envoy response flags 類似の例）を fixture の閉じた語彙にする。
const ENVOY_RESPONSE_FLAGS = ["UH", "UF", "UO", "NR", "URX", "UT", "RL"] as const;

describe("failure-reason-vocabulary: fixture（自己完結）", () => {
  it("閉じた語彙内のコードは違反にならない", () => {
    expect.hasAssertions();
    expect(checkClosedVocabulary("fixture", ["UF"], ENVOY_RESPONSE_FLAGS)).toStrictEqual([]);
  });

  it("閉じた語彙の外のコードは違反になる", () => {
    expect.hasAssertions();
    const violations = checkClosedVocabulary("fixture", ["WAT"], ENVOY_RESPONSE_FLAGS);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("WAT");
  });

  it("同じ未知コードが複数回出ても違反は1件にまとめる", () => {
    expect.hasAssertions();
    const violations = checkClosedVocabulary("fixture", ["WAT", "WAT"], ENVOY_RESPONSE_FLAGS);
    expect(violations).toHaveLength(1);
  });

  it("合成可能性: 複数の閉じた語彙コードが同時に成立しても違反にならない（upstream 接続失敗 かつ リトライ上限到達）", () => {
    expect.hasAssertions();
    expect(checkComposedReasonCodes("fixture", ["UF", "URX"], ENVOY_RESPONSE_FLAGS)).toStrictEqual(
      [],
    );
  });

  it("合成された組み合わせの中に語彙外のコードが混じっていれば、そのコードだけ違反になる", () => {
    expect.hasAssertions();
    const violations = checkComposedReasonCodes("fixture", ["UF", "WAT"], ENVOY_RESPONSE_FLAGS);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("WAT");
  });

  it("空の組み合わせ（単一値へ丸めた結果、理由が消えた状態）は違反になる", () => {
    expect.hasAssertions();
    expect(checkComposedReasonCodes("fixture", [], ENVOY_RESPONSE_FLAGS)).toHaveLength(1);
  });
});

describe("failure-reason-vocabulary: 実リポジトリ", () => {
  // 条件分岐でテストを飛ばさない。実装が消えたら静かに緑になる経路を作らないため
  // （原則 2: fail-fast / 受入条件「対象ゼロの緑は不合格」）。
  it("検査対象の実装が実在する", () => {
    expect.hasAssertions();
    expect(existsSync(FAILURE_REASON_IMPLEMENTATION_PATH)).toBe(true);
  });

  const failureReasonSource = readFileSync(FAILURE_REASON_IMPLEMENTATION_PATH, "utf-8");
  const declaredCodes = extractUnionStringLiterals(failureReasonSource, "FailureReason");

  it("FailureReason はリテラル union として宣言されており、閉じた語彙を持つ", () => {
    expect.hasAssertions();
    expect(declaredCodes.length).toBeGreaterThan(0);
  });

  it("宣言された語彙のみを使う場合は違反にならない", () => {
    expect.hasAssertions();
    expect(
      checkClosedVocabulary(FAILURE_REASON_IMPLEMENTATION_PATH, declaredCodes, declaredCodes),
    ).toStrictEqual([]);
  });

  it("宣言された語彙の外のコードを混ぜると違反になる", () => {
    expect.hasAssertions();
    const violations = checkClosedVocabulary(
      FAILURE_REASON_IMPLEMENTATION_PATH,
      [...declaredCodes, "not-a-declared-code"],
      declaredCodes,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("not-a-declared-code");
  });

  it("合成可能性: 宣言された複数コードを同時に組み合わせても違反にならない", () => {
    expect.hasAssertions();
    // 合成例（複数の異常が同時に成立する）を、実際の語彙で再現する。
    // 2 件未満しか語彙が無い場合はこの組み合わせ自体が意味を持たないため、
    // その場合は先頭 1 件のみで検証する（語彙が増えたら自動的に 2 件になる）。
    const composedCodes = declaredCodes.slice(0, Math.min(2, declaredCodes.length));
    expect(
      checkComposedReasonCodes(FAILURE_REASON_IMPLEMENTATION_PATH, composedCodes, declaredCodes),
    ).toStrictEqual([]);
  });
});
