/**
 * Claude Code ツール権限ポリシーの旧形式 shim。
 * core/policy.ts と adapters/claude/tool-mapping.ts へ委譲する。
 */
import type { Role } from "./core/role.ts";
import { mapClaudeToolToAction } from "./adapters/claude/tool-mapping.ts";
import { evaluatePolicy } from "./core/policy.ts";

export type Decision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string };

export { UnknownActionError as UnknownToolError } from "./core/policy.ts";

export function resolveDecision(toolName: string, role: Role): Decision {
  const action = mapClaudeToolToAction(toolName);
  const coreDecision = evaluatePolicy(action, role);
  return coreDecision.decision === "allow"
    ? { kind: "allow" }
    : { kind: "deny", reason: coreDecision.reason };
}
