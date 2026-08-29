import { Order } from "../domain/order/order.ts";
import { placeOrder } from "../application/order/place-order.ts";

export class OrderRepository {
  private readonly orders = new Map<string, Order>();

  save(id: string): void {
    this.orders.set(id, placeOrder(id));
  }
}
