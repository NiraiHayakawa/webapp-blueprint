import {
  checkForbiddenFieldNames,
  extractStringArrayLiteral,
  findForbiddenWord,
  normalizeFieldName,
} from "./log-field-vocabulary.check.ts";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
// 禁止語彙を実装する観測ヘルパー境界(§9「最小の縦切り」)。
// design-report が空スロットとして扱っていた logging/ 配下は、この
// テストを書いている時点で並行セッションによって実装が進行中だった
// (2026-08-09 に実測)。存在すれば正本(FORBIDDEN_FIELD_WORDS)との drift
// を検証し、無ければ「まだ空スロット」であることを明示的に検証する
// (原則11: 正本の鮮度。どちらの状態でも検査対象を持つ)。
const REDACT_IMPLEMENTATION_PATH = path.join(REPO_ROOT, "apps/api/src/logging/redact.ts");

describe("log-field-vocabulary: fixture（自己完結）", () => {
  it("禁止語を含まないフィールド名は違反にならない", () => {
    expect.hasAssertions();
    expect(checkForbiddenFieldNames("fixture", ["route", "status", "durationMs"])).toStrictEqual(
      [],
    );
  });

  it.each([
    { name: "snake_case", fieldName: "api_key" },
    { name: "camelCase", fieldName: "apiKey" },
    { name: "SCREAMING-KEBAB", fieldName: "API-KEY" },
  ])("正規化して同一視する: $name（$fieldName）は禁止キーとして検出される", ({ fieldName }) => {
    expect.hasAssertions();
    expect(normalizeFieldName(fieldName)).toBe("apikey");
    expect(findForbiddenWord(fieldName)).toBe("apikey");
  });

  it.each([
    { fieldName: "authorization" },
    { fieldName: "cookie" },
    { fieldName: "prompt" },
    { fieldName: "completion" },
    { fieldName: "secret" },
    { fieldName: "token" },
    { fieldName: "credential" },
    { fieldName: "signedUrl" },
    { fieldName: "headers" },
  ])("禁止語彙: $fieldName は違反になる", ({ fieldName }) => {
    expect.hasAssertions();
    const violations = checkForbiddenFieldNames("fixture", [fieldName]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain(fieldName);
  });

  it("接頭辞・接尾辞が付いていても禁止語を含んでいれば検出する（例: userApiKey）", () => {
    expect.hasAssertions();
    const violations = checkForbiddenFieldNames("fixture", ["userApiKey", "requestHeaders"]);
    expect(violations).toHaveLength(2);
  });
});

describe("log-field-vocabulary: 実リポジトリ", () => {
  // 条件分岐でテストを飛ばさない。実装が消えたら静かに緑になる経路を作らないため
  // （原則 2: fail-fast / 受入条件「対象ゼロの緑は不合格」）。
  it("検査対象の実装が実在する", () => {
    expect.hasAssertions();
    expect(existsSync(REDACT_IMPLEMENTATION_PATH)).toBe(true);
  });

  it("redact.ts が宣言する禁止語彙が、正本（FORBIDDEN_FIELD_WORDS）と一致する（drift 検出）", () => {
    expect.hasAssertions();
    const redactSource = readFileSync(REDACT_IMPLEMENTATION_PATH, "utf-8");
    const implementedWords = extractStringArrayLiteral(
      redactSource,
      "FORBIDDEN_FIELD_NAME_FRAGMENTS",
    );
    expect(implementedWords.length).toBeGreaterThan(0);
    expect(new Set(implementedWords)).toStrictEqual(
      new Set([
        "apikey",
        "authorization",
        "cookie",
        "prompt",
        "completion",
        "secret",
        "token",
        "credential",
        "signedurl",
        "headers",
      ]),
    );
  });

  it("redact.ts の禁止語彙自身が checkForbiddenFieldNames で検出される（実装と policy の整合）", () => {
    expect.hasAssertions();
    const redactSource = readFileSync(REDACT_IMPLEMENTATION_PATH, "utf-8");
    const implementedWords = extractStringArrayLiteral(
      redactSource,
      "FORBIDDEN_FIELD_NAME_FRAGMENTS",
    );
    const violations = checkForbiddenFieldNames(REDACT_IMPLEMENTATION_PATH, implementedWords);
    expect(violations).toHaveLength(implementedWords.length);
  });
});
