// architecture-check-disable-line forbidden-library
import { ok } from "neverthrow";

export function createOrder(id: string) {
  return ok(id);
}
