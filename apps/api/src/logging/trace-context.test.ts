import { beforeAll, describe, expect, it } from "vitest";
import { propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { extractTraceContext, InvalidTraceCarrierError } from "./trace-context.js";

const TRACE_ID_HEX_LENGTH = 32;
const PARENT_ID_HEX_LENGTH = 16;
const VALID_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const VALID_PARENT_ID = "00f067aa0ba902b7";
const VALID_TRACEPARENT = `00-${VALID_TRACE_ID}-${VALID_PARENT_ID}-01`;

function testMissingCarrierReturnsRootContext(): void {
  expect.hasAssertions();
  // oxlint-disable-next-line unicorn/no-useless-undefined -- carrier は省略可能な引数ではなく、型に undefined を含む必須引数。「carrier が無い」分岐を明示的に検証するために undefined を渡す
  expect(extractTraceContext(undefined)).toBe(ROOT_CONTEXT);
}

function testValidTraceparentExtractsSameTraceId(): void {
  expect.hasAssertions();
  const context = extractTraceContext({ traceparent: VALID_TRACEPARENT });
  expect(trace.getSpanContext(context)?.traceId).toBe(VALID_TRACE_ID);
}

function testValidCarrierWithTracestateAndBaggageDoesNotThrow(): void {
  expect.hasAssertions();
  expect(() =>
    extractTraceContext({
      traceparent: VALID_TRACEPARENT,
      tracestate: "vendor1=value1,vendor2=value2",
      baggage: "userId=alice",
    }),
  ).not.toThrow();
}

function testTracestateWithControlCharacterFails(): void {
  expect.hasAssertions();
  expect(() =>
    extractTraceContext({
      traceparent: VALID_TRACEPARENT,
      tracestate: "vendor1=value1\r\nSet-Cookie: evil=1",
    }),
  ).toThrow(InvalidTraceCarrierError);
}

function testBaggageWithControlCharacterFails(): void {
  expect.hasAssertions();
  expect(() =>
    extractTraceContext({
      traceparent: VALID_TRACEPARENT,
      baggage: "userId=alice\u0000",
    }),
  ).toThrow(InvalidTraceCarrierError);
}

function describeMissingCarrier(): void {
  describe("carrier が無い場合", () => {
    it(
      "carrier が undefined なら ROOT_CONTEXT を返し、新規 trace として開始できる",
      testMissingCarrierReturnsRootContext,
    );
  });
}

function describeValidCarrier(): void {
  describe("有効な carrier", () => {
    it(
      "有効な traceparent から、同じ trace-id を持つ context を抽出する",
      testValidTraceparentExtractsSameTraceId,
    );

    it(
      "tracestate / baggage を伴う有効な carrier は throw しない",
      testValidCarrierWithTracestateAndBaggageDoesNotThrow,
    );
  });
}

function describeBrokenTraceparentTable(): void {
  it.each([
    { name: "桁数不足", traceparent: "00-abc-00f067aa0ba902b7-01" },
    {
      name: "大文字混入",
      traceparent: `00-${VALID_TRACE_ID.toUpperCase()}-${VALID_PARENT_ID}-01`,
    },
    {
      name: "trace-id が全て0（W3C仕様で無効）",
      traceparent: `00-${"0".repeat(TRACE_ID_HEX_LENGTH)}-${VALID_PARENT_ID}-01`,
    },
    {
      name: "parent-id が全て0（W3C仕様で無効）",
      traceparent: `00-${VALID_TRACE_ID}-${"0".repeat(PARENT_ID_HEX_LENGTH)}-01`,
    },
    {
      name: "CRLF インジェクション",
      traceparent: `00-${VALID_TRACE_ID}-${VALID_PARENT_ID}-01\r\nSet-Cookie: evil=1`,
    },
  ])("$name の traceparent は明確に失敗する（黙って無視しない）", ({ traceparent }) => {
    expect.hasAssertions();
    expect(() => extractTraceContext({ traceparent })).toThrow(InvalidTraceCarrierError);
  });
}

function describeBrokenCarrier(): void {
  describe("壊れた carrier", () => {
    describeBrokenTraceparentTable();

    it(
      "tracestate に制御文字（CRLF）が混入すると失敗する",
      testTracestateWithControlCharacterFails,
    );

    it("baggage に制御文字（NUL）が混入すると失敗する", testBaggageWithControlCharacterFails);
  });
}

describe(extractTraceContext, () => {
  /**
   * `propagation.extract` は登録済みの propagator に委譲する。テストプロセスの
   * グローバル状態を汚さないよう、composition root（NodeSDK）とは独立に
   * このテストファイル自身が W3C の propagator を明示的に登録する。
   */
  beforeAll(() => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  describeMissingCarrier();
  describeValidCarrier();
  describeBrokenCarrier();
});
