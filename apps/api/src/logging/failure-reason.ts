/**
 * 失敗理由コードの閉じた語彙（原則12: 複数理由の合成可能な閉じた語彙）。
 *
 * 単一の `reason` ではなく、複数のコードが同時に立つ「集合」として表現する。
 * 「ストレージが利用不可で、かつリトライ上限にも達した」を
 * `storage-unavailable` 単独でも `retry-exhausted` 単独でもなく、
 * 両方が立った状態として 1 本のイベントで表せる。
 *
 * 語彙を増やす場合はこのユニオン型に literal を追加する。
 * {@link FAILURE_REASON_RETRY_SCOPE} が `Record<FailureReason, ...>` で
 * 全キーの網羅を型で要求するため、追加を怠ると型検査で落ちる。
 */
type FailureReason = "invalid-input" | "storage-unavailable" | "retry-exhausted";

/**
 * 理由コードごとの再試行可能性。書き手が warn / error を選ぶのではなく、
 * ここから機械的に導出する（原則12: `retryScope === "none" ? "error" : "warn"`）。
 *
 * - "invalid-input": 同じ入力で再試行しても結果は変わらない
 * - "storage-unavailable": 単独では一時的な障害の可能性があり再試行の余地がある
 * - "retry-exhausted": 既に再試行を使い切っており、これ以上の再試行に意味がない
 *
 * 型注釈ではなく `as const satisfies` で書く。注釈にすると各値が
 * `"none" | "retryable"` へ広がり、「この理由コードは実際にどちらなのか」という
 * ここにしか無い情報が型から消える（anti-slop no-known-value-widening）。
 * satisfies なら全キー網羅の要求はそのままに、値のリテラルが残る。
 */
const FAILURE_REASON_RETRY_SCOPE = {
  "invalid-input": "none",
  "storage-unavailable": "retryable",
  "retry-exhausted": "none",
} as const satisfies Readonly<Record<FailureReason, "none" | "retryable">>;

/**
 * 理由コードの合成規則。集合の中に 1 つでも retryScope "none" の理由が
 * あれば、全体としては再試行の余地が無いと判定する（最も悲観的な理由が勝つ）。
 * `storage-unavailable`（単独なら retryable）に `retry-exhausted` が
 * 合成されると全体が "none" に転じるのはこのため。
 */
function deriveRetryScope(reasons: ReadonlySet<FailureReason>): "none" | "retryable" {
  for (const reason of reasons) {
    if (FAILURE_REASON_RETRY_SCOPE[reason] === "none") {
      return "none";
    }
  }
  return "retryable";
}

/** ログレベルは reasons から機械的に導出する。書き手が直接 warn / error を選ばない。 */
function deriveLevel(reasons: ReadonlySet<FailureReason>): "warn" | "error" {
  return deriveRetryScope(reasons) === "none" ? "error" : "warn";
}

export { deriveLevel, deriveRetryScope };
export type { FailureReason };
