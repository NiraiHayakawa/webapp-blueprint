import { renderWidget } from "../../components/widget/widget.ts";

export function renderGreeting(name: string): string {
  return renderWidget({ label: `こんにちは、${name} さん` });
}
