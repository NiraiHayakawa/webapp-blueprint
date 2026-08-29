import { placeOrder } from "../../application/order/place-order.ts";

export class Order {
  private constructor(readonly id: string) {}

  static create(id: string): Order {
    placeOrder(id);
    return new Order(id);
  }
}
