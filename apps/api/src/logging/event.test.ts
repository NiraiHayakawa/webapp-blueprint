import { describe, expect, it, vi } from "vitest";
import { type ObservedEvent, serializeEvent } from "./event.js";
import type { SafeFields } from "./app-exception.js";
import { asFailureLogLine, type FailureFields, parseLogLine } from "./log-line-fixture.js";
import { ForbiddenLogFieldError } from "./redact.js";

vi.setConfig({ testTimeout: 5000 });

const STUB_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const STUB_SPAN_ID = "00f067aa0ba902b7";

/**
 * 「message とフィールドが同じ値から作られていること」の直接検証。
 * message を手で書いた期待値と比較するのではなく、**同じ payload に含まれる
 * 他のフィールド値から message を再構成できること**を確認する。手書きの
 * 期待値だとテスト側とコード側が別々に文言を持つ二重管理になり、
 * どちらかだけを直しても検出できない（外部境界を持たない純粋な計算のため
 * table-driven + 素の vitest。§4「テスト戦略」）。
 */
describe("serializeEvent（成功イベント）", () => {
  it.each([
    { operation: "task.register", durationMs: 12 },
    { operation: "task.register", durationMs: 340 },
  ])(
    "成功イベント（operation=$operation, durationMs=$durationMs）は同じフィールドから message を再構成できる",
    ({ operation, durationMs }) => {
      expect.hasAssertions();
      const event: ObservedEvent = {
        operation,
        durationMs,
        outcome: "success",
        level: "info",
        fields: {},
        traceId: STUB_TRACE_ID,
        spanId: STUB_SPAN_ID,
      };

      const logLine = parseLogLine(serializeEvent(event));

      expect(logLine.message).toBe(`${logLine.operation} → success (${logLine.durationMs}ms)`);
      expect(logLine.trace_id).toBe(STUB_TRACE_ID);
      expect(logLine.span_id).toBe(STUB_SPAN_ID);
    },
  );
});

/**
 * `it.each<T>` に型引数を渡して table の要素を文脈から型付ける。
 * `as FailureReason[]` を書かずに済ませるための形で、table を外の const へ
 * 追い出すのとは違い、tools/architecture の test-each-notation が
 * 「配列リテラルであること」を見て検査し続けられる（変数参照にすると
 * 静的に判定できず、検査が黙って素通りする）。
 */
describe("serializeEvent（失敗イベント）", () => {
  it.each<FailureFields>([
    { code: "TASK_TITLE_EMPTY", reasons: ["invalid-input"] },
    {
      code: "TASK_STORAGE_UNAVAILABLE",
      reasons: ["storage-unavailable", "retry-exhausted"],
    },
  ])(
    "失敗イベント（code=$code）は同じフィールドから message を再構成できる",
    ({ code, reasons }) => {
      expect.hasAssertions();
      const event: ObservedEvent = {
        operation: "task.register",
        durationMs: 5,
        outcome: "failure",
        level: "error",
        code,
        reasons,
        fields: {},
        traceId: STUB_TRACE_ID,
        spanId: STUB_SPAN_ID,
      };

      const logLine = asFailureLogLine(parseLogLine(serializeEvent(event)));

      expect(logLine.message).toBe(
        `${logLine.operation} → failure code=${logLine.code} reasons=${logLine.reasons.join(",")} (${logLine.durationMs}ms)`,
      );
      expect(logLine.trace_id).toBe(STUB_TRACE_ID);
      expect(logLine.span_id).toBe(STUB_SPAN_ID);
    },
  );
});

/** 呼び出し側が渡した fields だけが違う成功イベント（以下の検証はどれもそこだけを変える）。 */
function successEventWith(fields: SafeFields): ObservedEvent {
  return {
    operation: "task.register",
    durationMs: 1,
    outcome: "success",
    level: "info",
    fields,
    traceId: STUB_TRACE_ID,
    spanId: STUB_SPAN_ID,
  };
}

/**
 * fields をどう細工しても、既知フィールドの値は buildEventPayload が決めたものが
 * 残る（＝監視の判定条件が座るキーを呼び出し側が乗っ取れない。原則12 要件2）。
 */
describe("serializeEvent: 既知フィールドは呼び出し側の fields に上書きされない", () => {
  it("fields に「message」という名前の値を混ぜても、実際の message は変わらない", () => {
    expect.hasAssertions();
    const logLine = parseLogLine(serializeEvent(successEventWith({ message: "改ざんされた文言" })));

    expect(logLine.message).toBe("task.register → success (1ms)");
  });

  /**
   * 以前の buildEventPayload は `event.code !== undefined` のときだけ code を
   * 書いていたため、code を持たない成功イベントに限って fields 側の "code" が
   * そのまま出力へ抜けていた。上の message と同じ不変条件をここでも固定する。
   */
  it("fields に「code」という名前の値を混ぜても、code を持たないイベントの出力には現れない", () => {
    expect.hasAssertions();
    const logLine = parseLogLine(serializeEvent(successEventWith({ code: "偽装されたコード" })));

    expect(logLine.code).toBeUndefined();
  });
});

describe("serializeEvent の禁止キー検出", () => {
  it("禁止キーを含む fields を渡すと ForbiddenLogFieldError を throw する", () => {
    expect.hasAssertions();
    const event = successEventWith({ authToken: "xxxx" });

    expect(() => serializeEvent(event)).toThrow(ForbiddenLogFieldError);
  });
});
