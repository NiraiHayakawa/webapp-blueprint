// 禁止パターン: 業務コード（logging/ の外）が @opentelemetry/api を直接使っている。
import { trace } from "@opentelemetry/api";

export function handle(): void {
  trace.getTracer("business-code").startSpan("do-something").end();
}
