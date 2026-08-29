// index は re-export のみのはずだが、直接宣言を持ってしまっている。
export function renderGreeting(name: string): string {
  return `こんにちは、${name} さん`;
}
