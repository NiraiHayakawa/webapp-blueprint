/**
 * policy-as-test 全体で共有する「違反 1 件」の型。
 *
 * similarity-ts による型検査（`mise run similarity`）が secret-reference /
 * context-budget / source-freshness / dependency-pin / review-contract の
 * 各 `*.check.ts` にほぼ同一の `{ source, message }` インターフェース
 * （`SecretViolation` / `BudgetViolation` / `FreshnessViolation` /
 * `PinViolation` / `ReviewContractViolation`）が重複していることを検出した。
 * これは偶然形が似ているだけの重複ではなく、どの check も
 * 「どこで・何が原因で違反したか」という同じ知識を表しているため、
 * 所有レイヤをここに一本化する（design §5「similarity-ts（重複検出）」の
 * 対応表の 1 番目: 所有レイヤを直す）。
 *
 * `tools/architecture/src/violation.ts` と対になる、policy-as-test 側の型。
 * 対象が異なる（architecture checker はファイル/行/ルールID を持つが、
 * policy-as-test の各 check は任意の source 文字列だけを持つ）ため、
 * 型そのものは共有しない。
 */
export interface PolicyViolation {
  readonly source: string;
  readonly message: string;
}
