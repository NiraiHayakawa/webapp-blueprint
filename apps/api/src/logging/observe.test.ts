import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { propagation, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AppException } from "./app-exception.js";
import type { FailureReason } from "./failure-reason.js";
import { asFailureLogLine, parseLogLine } from "./log-line-fixture.js";
import { createInMemorySink } from "./sink.js";
import { observeResult } from "./observe.js";
import { InvalidTraceCarrierError } from "./trace-context.js";

vi.setConfig({ testTimeout: 5000 });

const OPERATION = "test.operation";
const STUB_STATUS_CODE = 503;
const STUB_ATTEMPTS = 3;
const VALID_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const VALID_PARENT_ID = "00f067aa0ba902b7";
const VALID_TRACEPARENT = `00-${VALID_TRACE_ID}-${VALID_PARENT_ID}-01`;

/**
 * `@opentelemetry/api` の `trace.setGlobalTracerProvider` はプロセス内で
 * 最初の 1 回しか成立しない（`registerGlobal` が二重登録を拒否する。
 * 2026-08-09 実測: 2 回目以降は戻り値 false で delegate が差し替わらず、
 * 新しい exporter が silent に無視される）。そのためテストごとに provider を
 * 作り直すのではなく、**プロセス内で 1 度だけ登録し、テスト間では
 * `exporter.reset()` で記録をクリアする**（tools/architecture の
 * third-party-sdk-composition-root ルールはテストファイルを対象外にする
 * ため、ここで `@opentelemetry/sdk-trace-base` を直接使ってよい）。
 */
const exporter = new InMemorySpanExporter();

function neverClassify(): AppException {
  throw new Error("呼ばれてはいけない");
}

async function testSuccessLeavesOneLine(): Promise<void> {
  expect.hasAssertions();
  const sink = createInMemorySink();

  const result = await observeResult({
    operation: OPERATION,
    sink,
    work: async () => "ok",
    classifyFailure: neverClassify,
  });

  expect(result).toBe("ok");
  expect(sink.lines).toHaveLength(1);
  const logLine = parseLogLine(sink.lines[0] ?? "");
  expect({ outcome: logLine.outcome, level: logLine.level }).toStrictEqual({
    outcome: "success",
    level: "info",
  });
}

async function testFailureLeavesOneLineAndPropagates(): Promise<void> {
  expect.hasAssertions();
  const sink = createInMemorySink();
  const classifiedException = new AppException({
    code: "STUB_FAILURE",
    statusCode: STUB_STATUS_CODE,
    reasons: new Set<FailureReason>(["storage-unavailable", "retry-exhausted"]),
    details: {},
    logDetails: { attempts: STUB_ATTEMPTS },
  });

  await expect(
    observeResult({
      operation: OPERATION,
      sink,
      work: async () => {
        throw new Error("boom");
      },
      classifyFailure: () => classifiedException,
    }),
  ).rejects.toBe(classifiedException);

  expect(sink.lines).toHaveLength(1);
  const logLine = asFailureLogLine(parseLogLine(sink.lines[0] ?? ""));
  expect({
    outcome: logLine.outcome,
    level: logLine.level,
    code: logLine.code,
    reasons: logLine.reasons,
  }).toStrictEqual({
    outcome: "failure",
    level: "error",
    code: "STUB_FAILURE",
    reasons: ["storage-unavailable", "retry-exhausted"],
  });
}

async function testSuccessOpensAndClosesOneSpan(): Promise<void> {
  expect.hasAssertions();
  await observeResult({
    operation: OPERATION,
    sink: createInMemorySink(),
    work: async () => "ok",
    classifyFailure: neverClassify,
  });

  const [span] = exporter.getFinishedSpans();
  expect(exporter.getFinishedSpans()).toHaveLength(1);
  expect(span?.name).toBe(OPERATION);
}

async function testFailureOpensAndClosesOneSpan(): Promise<void> {
  expect.hasAssertions();
  const classifiedException = new AppException({
    code: "STUB_FAILURE",
    statusCode: STUB_STATUS_CODE,
    reasons: new Set<FailureReason>(["invalid-input"]),
    details: {},
    logDetails: {},
  });

  await expect(
    observeResult({
      operation: OPERATION,
      sink: createInMemorySink(),
      work: async () => {
        throw new Error("boom");
      },
      classifyFailure: () => classifiedException,
    }),
  ).rejects.toBe(classifiedException);

  expect(exporter.getFinishedSpans()).toHaveLength(1);
}

async function testLogLineTraceIdMatchesSpan(): Promise<void> {
  expect.hasAssertions();
  const sink = createInMemorySink();

  await observeResult({
    operation: OPERATION,
    sink,
    work: async () => "ok",
    classifyFailure: neverClassify,
  });

  const logLine = parseLogLine(sink.lines[0] ?? "");
  const [span] = exporter.getFinishedSpans();
  expect(logLine.trace_id).toBe(span?.spanContext().traceId);
  expect(logLine.span_id).toBe(span?.spanContext().spanId);
}

async function testMissingCarrierStartsNewTrace(): Promise<void> {
  expect.hasAssertions();
  await observeResult({
    operation: OPERATION,
    sink: createInMemorySink(),
    work: async () => "ok",
    classifyFailure: neverClassify,
  });

  const [span] = exporter.getFinishedSpans();
  expect(span?.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/u);
}

async function testBrokenTraceparentFailsWithNoSpanOrLog(): Promise<void> {
  expect.hasAssertions();
  const sink = createInMemorySink();

  await expect(
    observeResult({
      operation: OPERATION,
      sink,
      work: async () => "ok",
      classifyFailure: neverClassify,
      carrier: { traceparent: "not-a-valid-traceparent" },
    }),
  ).rejects.toThrow(InvalidTraceCarrierError);

  expect(sink.lines).toHaveLength(0);
  expect(exporter.getFinishedSpans()).toHaveLength(0);
}

async function testValidTraceparentContinuesSameTrace(): Promise<void> {
  expect.hasAssertions();
  await observeResult({
    operation: OPERATION,
    sink: createInMemorySink(),
    work: async () => "ok",
    classifyFailure: neverClassify,
    carrier: { traceparent: VALID_TRACEPARENT },
  });

  const [span] = exporter.getFinishedSpans();
  expect(span?.spanContext().traceId).toBe(VALID_TRACE_ID);
}

async function testForbiddenSpanAttributeFailsBeforeWritingLog(): Promise<void> {
  expect.hasAssertions();
  const sink = createInMemorySink();
  const classifiedException = new AppException({
    code: "STUB_FAILURE",
    statusCode: STUB_STATUS_CODE,
    reasons: new Set<FailureReason>(["invalid-input"]),
    details: {},
    logDetails: { authToken: "xxxx" },
  });

  await expect(
    observeResult({
      operation: OPERATION,
      sink,
      work: async () => {
        throw new Error("boom");
      },
      classifyFailure: () => classifiedException,
    }),
  ).rejects.toThrow("ログの構造化フィールド名");

  // span 属性の検証で落ちるため、秘密混入のログ行は 1 本も残らない
  // （マスキングして通すのではなく、検出したら書き込み自体を止める）。
  expect(sink.lines).toHaveLength(0);
}

/**
 * carrier からの trace context 抽出（extractTraceContext →
 * propagation.extract）を実際に機能させるため、W3C の propagator も
 * 明示的に登録する（登録しないと No-op propagator が使われ、carrier の
 * 中身が無視される）。
 */
function setUpGlobalTracing(): void {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
}

function describeSpanLifecycle(): void {
  describe("span のライフサイクル", () => {
    it("成功時にちょうど1つの span を開いて閉じる", testSuccessOpensAndClosesOneSpan);

    it("失敗時もちょうど1つの span を開いて閉じる", testFailureOpensAndClosesOneSpan);

    it(
      "canonical log line の trace_id は、実際に張られた span の trace_id と一致する",
      testLogLineTraceIdMatchesSpan,
    );

    it("carrier を省略すると、新規 trace として正常に開始する", testMissingCarrierStartsNewTrace);
  });
}

function describeTraceContextValidation(): void {
  describe("W3C trace context の検証", () => {
    it(
      "壊れた traceparent を渡すと明確に失敗し、span もログも残らない",
      testBrokenTraceparentFailsWithNoSpanOrLog,
    );

    it(
      "有効な traceparent を渡すと、そのまま同じ trace を継続する",
      testValidTraceparentContinuesSameTrace,
    );
  });
}

function describeSpanAttributeForbiddenKeyCheck(): void {
  describe("span 属性の禁止キー検査", () => {
    it(
      "logDetails に禁止キーを含めると、span 属性の設定時点で明確に失敗する",
      testForbiddenSpanAttributeFailsBeforeWritingLog,
    );
  });
}

describe(observeResult, () => {
  beforeAll(setUpGlobalTracing);
  beforeEach(() => {
    exporter.reset();
  });

  it("成功した処理は1本の成功ログを残し、戻り値をそのまま返す", testSuccessLeavesOneLine);

  it(
    "失敗した処理は1本の失敗ログを残し、分類済みの AppException を呼び出し元に伝播する",
    testFailureLeavesOneLineAndPropagates,
  );

  describeSpanLifecycle();
  describeTraceContextValidation();
  describeSpanAttributeForbiddenKeyCheck();
});
