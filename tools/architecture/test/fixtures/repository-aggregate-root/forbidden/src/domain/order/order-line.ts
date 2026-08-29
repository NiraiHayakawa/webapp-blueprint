export class OrderLine {
  private constructor(readonly quantity: number) {}

  static create(quantity: number): OrderLine {
    return new OrderLine(quantity);
  }
}
