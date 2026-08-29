export interface WidgetProps {
  readonly label: string;
}

export function renderWidget(props: WidgetProps): string {
  return `<button>${props.label}</button>`;
}
