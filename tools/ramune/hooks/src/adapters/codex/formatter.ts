/**
 * Codex CLI PreToolUse hook の出力フォーマッタ。
 * Codex の PreToolUse wire contract に合わせる。
 * - 許可: 空の stdout（通常の permission flow に委ねる）
 * - 拒否: hookSpecificOutput.permissionDecision = "deny"
 */
import type { Decision } from "../../core/policy.ts";

export function formatCodexAllow(): string {
  return "";
}

export function formatCodexDeny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

export function formatCodexDecision(decision: Decision): string {
  return decision.decision === "deny" ? formatCodexDeny(decision.reason) : formatCodexAllow();
}
