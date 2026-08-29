import { renderGreeting } from "../../src/features/greeting/index.ts";

export function runGreetingStep(name: string): string {
  return renderGreeting(name);
}
