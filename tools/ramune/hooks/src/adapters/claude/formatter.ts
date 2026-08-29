/**
 * Claude Code PreToolUse hook の出力フォーマッタ。
 * - 許可: 空文字列（Claude Code の通常の権限フローに委ねる）
 * - 拒否: hookSpecificOutput による deny JSON
 */
import type { Decision } from "../../core/policy.ts";

export function formatClaudeAllow(): string {
  return "";
}

export function formatClaudeDeny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

export function formatClaudeDecision(decision: Decision): string {
  return decision.decision === "deny" ? formatClaudeDeny(decision.reason) : formatClaudeAllow();
}
