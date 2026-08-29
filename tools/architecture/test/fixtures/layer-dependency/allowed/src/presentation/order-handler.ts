import { Order } from "../domain/order/order.ts";
import { placeOrder } from "../application/order/place-order.ts";

export function handleOrderRequest(id: string): Order {
  return placeOrder(id);
}
