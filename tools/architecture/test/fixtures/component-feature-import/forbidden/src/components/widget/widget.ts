// components/ から features/ への import は全面禁止（公開面経由でも不可）。
import { renderGreeting } from "../../features/greeting/index.ts";

export function renderWidget(): string {
  return renderGreeting("ゲスト");
}
