export interface GreetingInput {
  readonly name: string;
}

export function renderGreeting(input: GreetingInput): string {
  return `こんにちは、${input.name} さん`;
}
