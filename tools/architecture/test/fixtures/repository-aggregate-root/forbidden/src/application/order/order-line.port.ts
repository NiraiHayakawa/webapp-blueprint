import type { OrderLine } from "../../domain/order/order-line.ts";

// OrderLine は Order という aggregate root 配下の非 root エンティティ。
// repository はここには生えてはいけない。
export interface OrderLineRepository {
  save(orderLine: OrderLine): Promise<void>;
}
