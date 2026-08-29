export class Order {
  private constructor(readonly id: string) {}

  static create(id: string): Order {
    return new Order(id);
  }
}
