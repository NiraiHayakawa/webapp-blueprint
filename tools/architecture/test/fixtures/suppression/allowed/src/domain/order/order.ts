// architecture-check-disable-line forbidden-library: 移行期間中の一時許可。ADR-0099 で剥がす予定。
import { ok } from "neverthrow";

export function createOrder(id: string) {
  return ok(id);
}
