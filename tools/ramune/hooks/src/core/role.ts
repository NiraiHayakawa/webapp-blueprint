/**
 * ramune agent roles.
 * Decoupled from client-specific subagent representations (Claude agent_type,
 * Antigravity subagent metadata, Codex context).
 */

export const ROLES = ["orchestrator", "planner", "worker", "integrator"] as const;

export type Role = (typeof ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

/** Type predicate checking whether an unknown value is a valid Role. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- 境界での型ガード関数
export function isRole(candidate: unknown): candidate is Role {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）による手書きガード
  return typeof candidate === "string" && ROLE_SET.has(candidate);
}

/** Error thrown when a role string fails validation. */
export class RoleValidationError extends Error {
  constructor(invalidRole: string) {
    super(`Invalid ramune role "${invalidRole}". Valid roles are: ${ROLES.join(", ")}.`);
    this.name = "RoleValidationError";
  }
}

/** Asserts that candidate is a valid Role, otherwise throws RoleValidationError. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- 境界での型ガード関数
export function assertRole(candidate: unknown): asserts candidate is Role {
  if (!isRole(candidate)) {
    throw new RoleValidationError(String(candidate));
  }
}

/** Check if role is a subagent (planner, worker, integrator). */
export function isSubagentRole(role: Role): boolean {
  return role !== "orchestrator";
}

/** Check if role is an executor (worker, integrator). */
export function isExecutorRole(role: Role): boolean {
  return role === "worker" || role === "integrator";
}

/** Check if role is the orchestrator. */
export function isOrchestratorRole(role: Role): boolean {
  return role === "orchestrator";
}

/** Check if role is the planner. */
export function isPlannerRole(role: Role): boolean {
  return role === "planner";
}

/** Check if role is a worker. */
export function isWorkerRole(role: Role): boolean {
  return role === "worker";
}

/** Check if role is the integrator. */
export function isIntegratorRole(role: Role): boolean {
  return role === "integrator";
}
