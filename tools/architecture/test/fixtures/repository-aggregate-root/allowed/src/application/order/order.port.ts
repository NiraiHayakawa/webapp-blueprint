import type { Order } from "../../domain/order/order.ts";

export interface OrderRepository {
  save(order: Order): Promise<void>;
}
