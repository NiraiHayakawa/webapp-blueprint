/**
 * Antigravity の subagent 情報から ramune の Role を解決する。
 */
import type { Role } from "../../core/role.ts";
import { AntigravityInputParseError, type AntigravityInput } from "./schema.ts";

const ANTIGRAVITY_ROLE_MAP: ReadonlyMap<string, Role> = new Map<string, Role>([
  ["orchestrator", "orchestrator"],
  ["main", "orchestrator"],
  ["planner", "planner"],
  ["worker", "worker"],
  ["integrator", "integrator"],
]);

export function resolveAntigravityRole(input: AntigravityInput): Role {
  if (input.subagentRole === undefined) {
    return "orchestrator";
  }

  const role = ANTIGRAVITY_ROLE_MAP.get(input.subagentRole);
  if (role !== undefined) {
    return role;
  }

  throw new AntigravityInputParseError(
    `subagent "${input.subagentRole}" は ramune が認識するサブエージェントではありません` +
      `（"planner" / "worker" / "integrator" のみ対応）。`,
  );
}
