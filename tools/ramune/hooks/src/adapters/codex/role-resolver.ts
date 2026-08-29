/**
 * Codex CLI の role / agent_type から ramune の Role を解決する。
 */
import type { Role } from "../../core/role.ts";
import { CodexInputParseError, type CodexInput } from "./schema.ts";

const CODEX_ROLE_MAP: ReadonlyMap<string, Role> = new Map<string, Role>([
  ["orchestrator", "orchestrator"],
  ["main", "orchestrator"],
  ["planner", "planner"],
  ["worker", "worker"],
  ["integrator", "integrator"],
]);

export function resolveCodexRole(input: CodexInput): Role {
  if (input.role === undefined) {
    return "orchestrator";
  }

  const role = CODEX_ROLE_MAP.get(input.role);
  if (role !== undefined) {
    return role;
  }

  throw new CodexInputParseError(
    `role "${input.role}" は ramune が認識するロールではありません` +
      `（"planner" / "worker" / "integrator" のみ対応）。`,
  );
}
