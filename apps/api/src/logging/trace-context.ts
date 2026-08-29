import { type Context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";

/**
 * W3C Trace Context（`traceparent` / `tracestate`）と W3C Baggage
 * （`baggage`）の運搬用の入力形。将来の HTTP/RPC 境界（契約層 ADR 0001 で
 * 選ばれる）が受け取った生ヘッダをそのまま渡す想定の、フレームワーク非依存の
 * 形にする（design §9「最小の縦切りは契約層の境界を越えない」と同じ理由で、
 * 特定の HTTP ライブラリの Headers 型には結合しない）。
 */
interface TraceCarrier {
  readonly traceparent?: string;
  readonly tracestate?: string;
  readonly baggage?: string;
}

/**
 * carrier の形式が W3C の仕様に反していた（原則2 fail-fast: 検証に失敗したら
 * 黙って無視せず、明確に失敗させる）。
 */
class InvalidTraceCarrierError extends Error {
  public constructor(fieldName: string, value: string) {
    super(`trace context の "${fieldName}" が W3C の形式に反する: ${JSON.stringify(value)}`);
    this.name = "InvalidTraceCarrierError";
  }
}

/**
 * `traceparent` の形式: `{version}-{trace-id}-{parent-id}-{trace-flags}`
 * （小文字 16 進数、桁数固定）。trace-id・parent-id が全て "0" の値は
 * 仕様上無効（https://www.w3.org/TR/trace-context/#traceparent-header-field-values）
 * であり、負の先読みで弾く。
 *
 * `^...$`（`m` フラグ無し）は文字列全体に一致することを要求するため、
 * CR/LF を含む値は許可された文字クラス（16 進数とハイフンのみ）に
 * 収まらず、この時点で不一致になる（CRLF インジェクションを許す形式不正の
 * 一種として、追加のケアなしに弾かれる）。
 */
const TRACEPARENT_PATTERN =
  /^[0-9a-f]{2}-(?!0{32}-)[0-9a-f]{32}-(?!0{16}-)[0-9a-f]{16}-[0-9a-f]{2}$/u;

/**
 * `tracestate` / `baggage` は自由度の高い key=value 列であり、本テンプレートは
 * その値を trace の相関判定には使わない不透明なパススルーデータとして扱う。
 * 完全な文法検証は行わず、制御文字（CR/LF/NUL 等、C0 制御ブロックと DEL）の
 * 混入だけを拒否する（ヘッダインジェクションを構造的に防ぐために必要十分な
 * 最小防御）。正規表現の制御文字クラスは意図の有無に関わらず lint で警告
 * される（no-control-regex）ため、文字コードの比較で書く。
 */
const C0_CONTROL_BLOCK_MAX_CODE_POINT = 0x1f;
const DELETE_CODE_POINT = 0x7f;

function isControlCharacter(codePoint: number): boolean {
  return codePoint <= C0_CONTROL_BLOCK_MAX_CODE_POINT || codePoint === DELETE_CODE_POINT;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    if (isControlCharacter(character.codePointAt(0) ?? 0)) {
      return true;
    }
  }
  return false;
}

function assertValidTraceparent(value: string): void {
  if (!TRACEPARENT_PATTERN.test(value)) {
    throw new InvalidTraceCarrierError("traceparent", value);
  }
}

function assertNoControlCharacters(fieldName: string, value: string): void {
  if (containsControlCharacter(value)) {
    throw new InvalidTraceCarrierError(fieldName, value);
  }
}

function validateCarrier(carrier: Readonly<TraceCarrier>): void {
  if (carrier.traceparent !== undefined) {
    assertValidTraceparent(carrier.traceparent);
  }
  if (carrier.tracestate !== undefined) {
    assertNoControlCharacters("tracestate", carrier.tracestate);
  }
  if (carrier.baggage !== undefined) {
    assertNoControlCharacters("baggage", carrier.baggage);
  }
}

/**
 * carrier から trace context を取り出す。**「carrier が無い」ことと
 * 「carrier が壊れている」ことを区別する**のがこの関数の唯一の責務
 * （design §2 原則12 の要件詳細）。
 *
 * - carrier 自体が `undefined`（= 最初のリクエスト）は正当な状態であり、
 *   何も継承しない `ROOT_CONTEXT` を返して新規 trace を開始させる。
 * - carrier はあるが形式が W3C に反する場合は、黙って無視せず
 *   {@link InvalidTraceCarrierError} を throw する。
 * - carrier が有効な場合のみ、登録済みの propagator（既定は
 *   tracecontext + baggage）で実際に抽出する。
 */
function extractTraceContext(carrier: Readonly<TraceCarrier> | undefined): Context {
  if (carrier === undefined) {
    return ROOT_CONTEXT;
  }
  validateCarrier(carrier);
  return propagation.extract(ROOT_CONTEXT, carrier);
}

export { extractTraceContext, InvalidTraceCarrierError };
export type { TraceCarrier };
