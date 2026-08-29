import { Order } from "../../domain/order/order.ts";

export function placeOrder(id: string): Order {
  return Order.create(id);
}
