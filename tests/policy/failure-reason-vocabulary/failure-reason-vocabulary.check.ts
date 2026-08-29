/**
 * docs/principles/observable-by-design.md 要件3「失敗の理由は、
 * あらかじめ列挙された閉じた語彙のコードで表す...1 つの事象に複数の理由が
 * 同時に成り立ちうる場合、単一の値へ丸めず、理由の組み合わせを表現できる
 * 形にする」の機械強制。
 *
 * 検証内容は2点:
 * ① 実際に使われている失敗理由コードが、宣言された閉じた語彙の外に出て
 *    いないこと
 * ② 複数のコードが同時に成立する状況（例: "UF,URX" = upstream
 *    接続失敗 かつ リトライ上限到達）を、単一の値へ丸めずに表現できること
 *
 * テンプレートはまだエラーコード体系を選んでいない（design 報告に明記の
 * 空スロット）ため、閉じた語彙そのものは呼び出し側が渡す設定値として
 * 受け取る汎用チェックにする（transport-client-location と同じ形）。
 */
import type { PolicyViolation } from "../violation.ts";

/** 閉じた語彙の外にあるコードを検出する。同じコードが複数回出ても違反は1件にまとめる。 */
function checkClosedVocabulary(
  source: string,
  usedCodes: readonly string[],
  allowedCodes: readonly string[],
): PolicyViolation[] {
  const allowedSet = new Set(allowedCodes);
  const violations: PolicyViolation[] = [];
  const reportedCodes = new Set<string>();

  for (const code of usedCodes) {
    if (allowedSet.has(code) || reportedCodes.has(code)) {
      continue;
    }
    reportedCodes.add(code);
    violations.push({
      source,
      message: `失敗理由コード "${code}" が閉じた語彙（${[...allowedSet].join(" / ")}）の外の値`,
    });
  }

  return violations;
}

/**
 * 1 つの事象に同時に成立する複数のコード（例: ["UF", "URX"]）を
 * 検証する。`checkClosedVocabulary` をそのまま複数コードの配列に適用できる
 * こと自体が、reason を単一値へ丸めず複数コードの組み合わせとして表現
 * できることの実証になる（合成可能性は「配列を受け付け、各要素を独立に
 * 語彙チェックする」という型の形で表現する）。
 */
function checkComposedReasonCodes(
  source: string,
  composedCodes: readonly string[],
  allowedCodes: readonly string[],
): PolicyViolation[] {
  if (composedCodes.length === 0) {
    return [
      {
        source,
        message:
          "失敗理由コードの組み合わせが空。単一値へ丸めた結果ではなく、少なくとも1つのコードを持つこと",
      },
    ];
  }
  return checkClosedVocabulary(source, composedCodes, allowedCodes);
}

/**
 * ソース文字列から `type <typeName> = "a" | "b" | ...;` 形式のリテラル
 * union 型が宣言する文字列メンバーを抜き出す（テキストからの軽量な抽出。
 * ts-morph は tests/policy から利用できないため AST ではなくこの形にする）。
 *
 * 実装(例: apps/api/src/logging/failure-reason.ts の `FailureReason`)が
 * 宣言する閉じた語彙を、実際の repo に対する `checkClosedVocabulary` /
 * `checkComposedReasonCodes` の入力として使うために用意する。
 */
function extractUnionStringLiterals(source: string, typeName: string): string[] {
  const declarationPattern = new RegExp(`type\\s+${typeName}\\s*=\\s*([^;]+);`, "u");
  const match = declarationPattern.exec(source);
  const unionBody = match?.[1];
  if (unionBody === undefined) {
    return [];
  }
  return [...unionBody.matchAll(/"(?<literal>[^"]*)"/gu)].map(
    (entry) => entry.groups?.literal ?? "",
  );
}

export { checkClosedVocabulary, checkComposedReasonCodes, extractUnionStringLiterals };
