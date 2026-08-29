/**
 * docs/principles/observable-by-design.md 要件5「秘密の値や、処理対象
 * そのものの本文(自由入力・生成された文章など)を、記録の属性として
 * 存在させない...存在させないための対策はマスキングして隠すことではなく、
 * そもそも作らないことである。混入したことを検知したら、隠さず処理を
 * 止める」の機械強制。
 *
 * 禁止キーの語彙: apikey / authorization / cookie / prompt /
 * completion / secret / token / credential / signedurl / headers。
 * 区切り文字（`_` `-`）を除去し小文字化して正規化した上で比較する
 * （`api_key` / `apiKey` / `API-KEY` を同一視する）。
 *
 * secret-reference（tests/policy/secret-reference/）とは対象が異なる。
 * secret-reference は `.env.example` / workflow の `env:` という
 * **設定値の置き場所**を見るのに対し、ここでは**ログの属性として
 * 構造化された記録に現れるフィールド名**を見る。同じ「禁止語彙」という
 * 発想の別の適用であり、対象（設定値 vs ログフィールド）が異なるため
 * 共通化はしない（design §5「similarity-ts」の「重複を残し、理由つきで
 * 抑制する」に相当する判断）。
 */
import type { PolicyViolation } from "../violation.ts";

const FORBIDDEN_FIELD_WORDS = [
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

/** 区切り文字を除去し小文字化する（`api_key` / `apiKey` / `API-KEY` を同一視する）。 */
function normalizeFieldName(fieldName: string): string {
  return fieldName.replaceAll(/[_-]/gu, "").toLowerCase();
}

function findForbiddenWord(fieldName: string): string | undefined {
  const normalized = normalizeFieldName(fieldName);
  return FORBIDDEN_FIELD_WORDS.find((word) => normalized.includes(word));
}

/**
 * ログの属性として渡されるフィールド名一覧を検証する。
 * マスキングして通すのではなく、検出したら違反として報告する
 * （原則2 fail-fast: 混入を検知したら隠さず止める）。
 */
function checkForbiddenFieldNames(
  source: string,
  fieldNames: readonly string[],
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const fieldName of fieldNames) {
    const forbiddenWord = findForbiddenWord(fieldName);
    if (forbiddenWord === undefined) {
      continue;
    }
    violations.push({
      source,
      message: `フィールド名 "${fieldName}" に禁止キー "${forbiddenWord}" が含まれる（ログの属性として存在させない。マスキングせず検出したら落とす）`,
    });
  }
  return violations;
}

/**
 * ソース文字列から `const <constName> = [...] as const;` 形式の文字列配列
 * リテラルの要素を抜き出す（review-contract.check.ts のインラインコード抽出
 * と同種の、テキストからの軽量な抽出）。
 *
 * 実装(例: apps/api/src/logging/redact.ts の `FORBIDDEN_FIELD_NAME_FRAGMENTS`)
 * が宣言する禁止語彙と、ここで宣言する `FORBIDDEN_FIELD_WORDS`(正本)との
 * drift を検出するために使う（原則11: 正本の鮮度）。ts-morph は
 * tests/policy から利用できない（tools/architecture 配下のみの依存）ため、
 * AST ではなくテキスト抽出にとどめる。
 */
function extractStringArrayLiteral(source: string, constName: string): string[] {
  const declarationPattern = new RegExp(`${constName}\\s*=\\s*\\[([^\\]]*)\\]`, "u");
  const match = declarationPattern.exec(source);
  const arrayBody = match?.[1];
  if (arrayBody === undefined) {
    return [];
  }
  return [...arrayBody.matchAll(/"(?<literal>[^"]*)"/gu)].map(
    (entry) => entry.groups?.literal ?? "",
  );
}

export {
  FORBIDDEN_FIELD_WORDS,
  normalizeFieldName,
  findForbiddenWord,
  checkForbiddenFieldNames,
  extractStringArrayLiteral,
};
