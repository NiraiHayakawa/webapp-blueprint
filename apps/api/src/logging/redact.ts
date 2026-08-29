import type { SafeFields } from "./app-exception.js";

/**
 * 禁止フィールド名の断片。マスキングはせず、検出したら throw する。
 * マスキングは「気づかれずに value が空文字へ差し替わる」silent fallback の
 * 一種であり、原則2（fail-fast）に反する。
 */
const FORBIDDEN_FIELD_NAME_FRAGMENTS = [
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
] as const;

/** 構造化フィールドに禁止キーが混入していた（呼び出し元のバグとして即座に落とす）。 */
class ForbiddenLogFieldError extends Error {
  public constructor(fieldName: string) {
    super(`ログの構造化フィールド名 "${fieldName}" は禁止キーを含む`);
    this.name = "ForbiddenLogFieldError";
  }
}

/** 大小文字・区切り文字の違いを正規化してから断片一致を見る（"api_key" 等も検出する）。 */
function normalizeFieldName(fieldName: string): string {
  return fieldName.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

/**
 * シリアライザ側の防衛線（二層防御の②）。①の防衛線（安全な値の型しか
 * 作れないこと）は app-exception.ts の SafeFields が担う。
 *
 * 引数の型はその SafeFields そのものにする。見るのはキー名だけなので値型は
 * 何でも通せるが、`Record<string, unknown>` にすると「どんな辞書でも渡せる」
 * という誤った契約を宣言することになり、①を通っていない値の経路を型が
 * 許してしまう（anti-slop no-unsafe-dictionary-type）。実際の呼び出し元
 * （event.ts の event.fields / observe.ts の logDetails）はどちらも SafeFields。
 */
function assertNoForbiddenFields(fields: SafeFields): void {
  for (const fieldName of Object.keys(fields)) {
    const normalized = normalizeFieldName(fieldName);
    const matchedFragment = FORBIDDEN_FIELD_NAME_FRAGMENTS.find((fragment) =>
      normalized.includes(fragment),
    );
    if (matchedFragment !== undefined) {
      throw new ForbiddenLogFieldError(fieldName);
    }
  }
}

export { assertNoForbiddenFields, ForbiddenLogFieldError };
