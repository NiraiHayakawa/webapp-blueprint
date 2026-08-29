/**
 * Claude Code の agent_type から ramune の Role を解決する。
 */
import type { Role } from "../../core/role.ts";
import { ClaudeInputParseError, type ClaudeInput } from "./schema.ts";

const CLAUDE_ROLE_MAP: ReadonlyMap<string, Role> = new Map<string, Role>([
  ["orchestrator", "orchestrator"],
  ["planner", "planner"],
  ["worker", "worker"],
  ["integrator", "integrator"],
]);

export function resolveClaudeRole(input: ClaudeInput): Role {
  if (input.agentType === undefined) {
    return "orchestrator";
  }

  const role = CLAUDE_ROLE_MAP.get(input.agentType);
  if (role !== undefined) {
    return role;
  }

  throw new ClaudeInputParseError(
    `agent_type "${input.agentType}" は ramune が認識するサブエージェントではありません` +
      `（"planner" / "worker" / "integrator" のみ対応）。`,
  );
}
