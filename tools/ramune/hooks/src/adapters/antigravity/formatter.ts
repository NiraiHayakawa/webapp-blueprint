/**
 * Antigravity PreToolUse hook の出力フォーマッタ。
 * - 許可: { decision: "allow" }
 * - 拒否: { decision: "deny", reason: string }
 */
import type { Decision } from "../../core/policy.ts";

export function formatAntigravityAllow(): string {
  return JSON.stringify({ decision: "allow" });
}

export function formatAntigravityDeny(reason: string): string {
  return JSON.stringify({
    decision: "deny",
    reason,
  });
}

export function formatAntigravityDecision(decision: Decision): string {
  return decision.decision === "deny"
    ? formatAntigravityDeny(decision.reason)
    : formatAntigravityAllow();
}
