// logging/ 境界: trace 相関目的で @opentelemetry/api を使ってよい唯一の場所。
import { trace } from "@opentelemetry/api";

export function currentTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId;
}
