import { renderFoo } from "../foo/index.ts";

export function renderSibling(): string {
  return `sibling(${renderFoo()})`;
}
