import type { Span } from "@opentelemetry/api";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { AppException, SafeFields } from "./app-exception.js";
import { deriveLevel } from "./failure-reason.js";
import { type ObservedEvent, serializeEvent } from "./event.js";
import type { Sink } from "./sink.js";
import { assertNoForbiddenFields } from "./redact.js";
import { extractTraceContext, type TraceCarrier } from "./trace-context.js";

/**
 * observeResult 自身の instrumentation スコープ名。業務コードの `operation`
 * とは別の軸（tracer 自身の識別子）であり、span 名の方に `operation` を使う。
 */
const TRACER_NAME = "webapp-blueprint-observability";

interface ObserveResultParams<T> {
  readonly operation: string;
  readonly sink: Sink;
  readonly work: () => Promise<T>;
  /**
   * 生の例外を AppException へ分類する。この関数に現れない例外は
   * 分類漏れであり、observeResult は握りつぶさずそのまま伝播させる
   * （原則2 fail-fast: 未知の失敗を汎用イベントへ丸めない）。
   *
   * 引数名が `cause` なのは、これが `work()` が throw した生の値そのもの
   * ——つまり `new Error(message, { cause })` に渡すのと同じもの——だから。
   * catch した値に `unknown` より狭い型を名乗らせることはできず（何が
   * throw されるかは型で保証されない）、ここを飾ることは嘘になる。
   * 分類はこの関数の中で instanceof によって行われ、その先はドメイン型
   * （AppException）だけが流れる。
   */
  readonly classifyFailure: (cause: unknown) => AppException;
  /**
   * 将来の HTTP/RPC 境界から W3C trace context を受け取るための差し込み口。
   * 省略時（この縦切りの driving adapter のように carrier を持たない場合）は
   * 新規 trace として開始する（trace-context.ts 参照）。
   */
  readonly carrier?: TraceCarrier;
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

interface SpanIds {
  readonly traceId: string;
  readonly spanId: string;
}

function spanContextIds(span: Span): SpanIds {
  const spanContext = span.spanContext();
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

/**
 * span 属性へ安全なフィールドだけを設定する。ログの属性（event.ts の
 * buildEventPayload）と全く同じ禁止キー検査（redact.ts）を再利用する —
 * ログだけ守ってトレースから秘密が漏れるのでは原則12の要件5を満たさない。
 * `{ ...fields }` で複製してから渡すのは、Span.setAttributes の型が
 * readonly を要求しないため（呼び出し先が変更しないことは実装の契約であり、
 * 型では保証されない）。
 */
function setSafeSpanAttributes(span: Span, fields: SafeFields): void {
  assertNoForbiddenFields(fields);
  span.setAttributes({ ...fields });
}

function buildSuccessEvent(operation: string, durationMs: number, ids: SpanIds): ObservedEvent {
  return {
    operation,
    durationMs,
    outcome: "success",
    level: "info",
    fields: {},
    traceId: ids.traceId,
    spanId: ids.spanId,
  };
}

interface FailureEventInput {
  readonly operation: string;
  readonly durationMs: number;
  readonly appException: Readonly<AppException>;
  readonly ids: SpanIds;
}

function buildFailureEvent(input: Readonly<FailureEventInput>): ObservedEvent {
  const { operation, durationMs, appException, ids } = input;
  return {
    operation,
    durationMs,
    outcome: "failure",
    level: deriveLevel(appException.reasons),
    code: appException.code,
    reasons: [...appException.reasons],
    fields: appException.logDetails,
    traceId: ids.traceId,
    spanId: ids.spanId,
  };
}

interface SpanRecordingContext<T> {
  readonly span: Span;
  readonly params: Readonly<ObserveResultParams<T>>;
  readonly startedAt: number;
}

function writeSuccessEvent<T>(context: Readonly<SpanRecordingContext<T>>): void {
  setSafeSpanAttributes(context.span, {});
  context.span.setStatus({ code: SpanStatusCode.OK });
  context.params.sink.write(
    serializeEvent(
      buildSuccessEvent(
        context.params.operation,
        elapsedMs(context.startedAt),
        spanContextIds(context.span),
      ),
    ),
  );
}

function writeFailureEvent<T>(
  context: Readonly<SpanRecordingContext<T>>,
  appException: Readonly<AppException>,
): void {
  setSafeSpanAttributes(context.span, appException.logDetails);
  context.span.setStatus({ code: SpanStatusCode.ERROR, message: appException.code });
  context.params.sink.write(
    serializeEvent(
      buildFailureEvent({
        operation: context.params.operation,
        durationMs: elapsedMs(context.startedAt),
        appException,
        ids: spanContextIds(context.span),
      }),
    ),
  );
}

/**
 * 処理単位を丸ごとラップする canonical observer。
 * 成功・失敗どちらの経路でも、必ず 1 本だけログを書き、必ず 1 つだけ span を
 * 開いて閉じてから結果を返す（成功時は値を返す、失敗時は分類済みの
 * AppException を rethrow する）。業務コード（`work`）はここに何が起きたかを
 * 渡すだけで、ログの実装（どこへ書くか）もトレースの送り先も HTTP への
 * 見せ方も知らない（原則12: 観測境界の分離）。
 */
async function runObservedWork<T>(context: Readonly<SpanRecordingContext<T>>): Promise<T> {
  try {
    const result = await context.params.work();
    writeSuccessEvent(context);
    return result;
  } catch (error) {
    // catch の束縛名は unicorn/catch-error-name が `error` を要求するため
    // 揃える（classifyFailure 側の引数名 `cause` とは別の規約が効く場所）。
    const appException = context.params.classifyFailure(error);
    writeFailureEvent(context, appException);
    throw appException;
  } finally {
    context.span.end();
  }
}

async function observeResult<T>(params: Readonly<ObserveResultParams<T>>): Promise<T> {
  const parentContext = extractTraceContext(params.carrier);
  const tracer = trace.getTracer(TRACER_NAME);
  const startedAt = Date.now();

  async function runWithSpan(span: Span): Promise<T> {
    return await runObservedWork({ span, params, startedAt });
  }

  return await tracer.startActiveSpan(params.operation, {}, parentContext, runWithSpan);
}

export { observeResult };
