import { renderBar } from "./features/bar/index.ts";

export function renderFoo(): string {
  return `foo(${renderBar()})`;
}
