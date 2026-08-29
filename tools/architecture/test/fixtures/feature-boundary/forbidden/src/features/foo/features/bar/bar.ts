// 子 feature（bar）から親 feature（foo）を参照している。
// 公開面（index）経由であっても、親への import は禁止される。
import { renderFoo } from "../../index.ts";

export function renderBar(): string {
  return `bar(${renderFoo()})`;
}
