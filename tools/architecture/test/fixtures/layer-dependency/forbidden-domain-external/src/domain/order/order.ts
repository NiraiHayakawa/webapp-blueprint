import leftPad from "left-pad";

export class Order {
  private constructor(readonly id: string) {}

  static create(id: string): Order {
    return new Order(leftPad(id, 8));
  }
}
