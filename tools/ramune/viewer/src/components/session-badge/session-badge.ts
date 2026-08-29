import type { GraphV2 } from "../../lib/graph-source/graph-source.ts";

// props の型を独自に宣言せず、グラフの session をそのまま受ける。`state` の
// union を別に定義するとドメイン型（ramune-graph の GraphSession）と同じ形の型が
// 2つになり、similarity-ts が型の重複として実際に検出した。ここは「偶然形が
// 似ているだけ」ではなく同じ知識なので、所有レイヤ（ドメイン型）を使う側に倒す。
type SessionBadgeProps = GraphV2["session"];

const STYLE = `<style>
  .session-badge { display: inline-flex; align-items: center; gap: 6px; font-family: system-ui, sans-serif; font-size: 13px; padding: 4px 10px; border-radius: 999px; border: 1px solid #d1d5db; color: #374151; }
  .session-badge[data-session-active="true"] { border-color: #2563eb; color: #1d4ed8; }
  .session-dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; }
  .session-badge[data-session-active="true"] .session-dot { background: #2563eb; }
  @media (prefers-color-scheme: dark) {
    .session-badge { border-color: #4b5563; color: #d1d5db; }
    .session-badge[data-session-active="true"] { border-color: #60a5fa; color: #93c5fd; }
    .session-badge[data-session-active="true"] .session-dot { background: #60a5fa; }
  }
</style>`;

/**
 * ramune モードの稼働/非稼働（`.ramune/graph.json` の `session.state`。
 * ADR 0003）を表示する props-only な component。
 *
 * これを画面に出す理由: 稼働中は PreToolUse hook が Planner/Worker の役割を
 * fail-closed で強制し、同じ worktree を cwd にする他のセッションからも
 * `Bash` / `Edit` / `Write` が拒否される（docs/recipes/tools/ramune.md）。
 * グラフの中身だけを見せて稼働状態を隠すと、「なぜツールが拒否されるのか」を
 * 画面から判断できない。
 */
function renderSessionBadge(props: Readonly<SessionBadgeProps>): string {
  const isActive = props.state === "active";
  const label = isActive ? "稼働中" : "非稼働";
  return `${STYLE}<p class="session-badge" data-session-active="${String(isActive)}"><span class="session-dot"></span>ramune: ${label}</p>`;
}

export { renderSessionBadge };
