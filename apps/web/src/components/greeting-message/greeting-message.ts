interface GreetingMessageProps {
  readonly message: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Props-only な component（§3「フロントエンド: 再帰的 features」）。
 * API モックを使わず、入力から出力が決まる純粋関数として実装する。
 */
function renderGreetingMessage(props: Readonly<GreetingMessageProps>): string {
  return `<p class="greeting-message">${escapeHtml(props.message)}</p>`;
}

export { renderGreetingMessage };
