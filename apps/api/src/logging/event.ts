import type { FailureReason } from "./failure-reason.js";
import type { SafeFields, SafeFieldValue } from "./app-exception.js";
import { assertNoForbiddenFields } from "./redact.js";

type EventLevel = "info" | "warn" | "error";
type EventOutcome = "success" | "failure";

/**
 * 横断境界が扱う唯一のイベント表現。**`message` フィールドを持たない。**
 * message を保持する場所そのものが型に無いため、呼び出し側が独自の文言を
 * 混ぜ込む経路が構造的に存在しない（原則12: message は field からの描画）。
 */
interface ObservedEvent {
  readonly operation: string;
  readonly durationMs: number;
  readonly outcome: EventOutcome;
  readonly level: EventLevel;
  readonly code?: string;
  readonly reasons?: readonly FailureReason[];
  readonly fields: SafeFields;
  /**
   * 観測境界(observe.ts)が開いた span の trace context（原則12「トレースの
   * 送り先」節）。observeResult は常に span を開いてからイベントを組み立てる
   * ため必須フィールドにする(呼び出し側が相関情報を渡し忘れる経路を型で塞ぐ)。
   * JSON 上のキー名は `trace_id` / `span_id`（ログ・トレース双方の相関に
   * 使われる一般的な慣例に合わせる。buildEventPayload 参照）。
   */
  readonly traceId: string;
  readonly spanId: string;
}

/**
 * message を組み立てる唯一の関数（design 報告「描画関数を1つに絞る」）。
 * これ以外の場所で message 文字列を作らない運用にする
 * （architecture checker 側で強制する分は報告に明記）。
 */
function renderEventMessage(event: Readonly<ObservedEvent>): string {
  if (event.outcome === "success") {
    return `${event.operation} → success (${event.durationMs}ms)`;
  }
  const reasonsText = (event.reasons ?? []).join(",");
  return `${event.operation} → failure code=${event.code ?? ""} reasons=${reasonsText} (${event.durationMs}ms)`;
}

/**
 * ログ行 1 本のフィールド値として存在しうる型。SafeFields の値に reasons の
 * 配列と undefined を足しただけで、それ以外は作れない。
 *
 * `unknown` にしない理由: この payload は 1 リクエスト 1 イベントとして JSON へ
 * 直列化されるものなので、値が JSON にできる形であることは元から契約であり、
 * `Record<string, unknown>` はその契約を表現できていなかった
 * （anti-slop no-unsafe-dictionary-type）。JSON 値一般ではなく SafeFieldValue
 * から導出するのは、フィールド値の語彙を決める権限が app-exception.ts 側に
 * あるため（原則12 要件4: 外向き・内向きの分離を型で持つのはあちら）。
 */
type EventPayloadValue = SafeFieldValue | readonly FailureReason[] | undefined;
type EventPayload = Readonly<Record<string, EventPayloadValue>>;

/**
 * fields ∪ 描画済み message ∪ 導出済みメタフィールドを 1 つの payload にする。
 * `...event.fields` を**先に**展開し、既知フィールド（message・operation 等）を
 * **後から**上書きする順序が要（fields に "message" という名前の値が混入しても、
 * 実際に出力される message は renderEventMessage の結果のまま変わらない）。
 *
 * code / reasons は「持たないイベントでは条件分岐で足さない」のではなく、
 * 常に置いて undefined のまま渡す。JSON.stringify は値が undefined のキーを
 * 出力しないので直列化結果は同じで、かつ上の「既知フィールドが後勝ち」という
 * 不変条件が成功イベントにも等しく効く（条件分岐だと fields 側の "code" が
 * すり抜ける穴が残っていた）。
 *
 * 戻り値に型注釈を付けず `satisfies` で検証するのは、注釈にすると payload の
 * 実際の形（どのキーがどの型で入ったか）が辞書型へ潰れて消えるため
 * （anti-slop no-known-value-widening が指す「既知の値の証拠を捨てる」形）。
 */
function buildEventPayload(event: Readonly<ObservedEvent>) {
  assertNoForbiddenFields(event.fields);

  return {
    ...event.fields,
    message: renderEventMessage(event),
    operation: event.operation,
    outcome: event.outcome,
    level: event.level,
    durationMs: event.durationMs,
    trace_id: event.traceId,
    span_id: event.spanId,
    code: event.code,
    reasons: event.reasons,
  } satisfies EventPayload;
}

function serializeEvent(event: Readonly<ObservedEvent>): string {
  return JSON.stringify(buildEventPayload(event));
}

export { serializeEvent };
export type { ObservedEvent };
