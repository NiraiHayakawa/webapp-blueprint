/**
 * Abstract action types for ramune operations.
 * Decoupled from client-specific tool names across Claude Code, Antigravity, and Codex CLI.
 */

export const ACTION_TYPES = [
  "READ_GRAPH",
  "CLAIM_READY",
  "CLAIM_INTEGRATION",
  "ABANDON_ASSIGNMENT",
  "RESUME",
  "START_SESSION",
  "END_SESSION",
  "APPLY_OPS",
  "RECORD_RESULT",
  "SUBMIT_CANDIDATE",
  "REQUEST_REPLAN",
  "ADVANCE_INTEGRATION",
  "RECORD_INTEGRATION_OUTCOME",
  "FILE_MUTATION",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

const ACTION_TYPE_SET: ReadonlySet<string> = new Set(ACTION_TYPES);

/** Raw tool invocation structure shared across client adapters */
export interface RawToolInvocationPayload {
  readonly name?: unknown;
  readonly args?: unknown;
}

/** Type predicate checking whether an unknown value is a valid ActionType. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- 境界での型ガード関数
export function isActionType(candidate: unknown): candidate is ActionType {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）による手書きガード
  return typeof candidate === "string" && ACTION_TYPE_SET.has(candidate);
}

/** Error thrown when an action type is invalid. */
export class InvalidActionTypeError extends Error {
  constructor(invalidAction: string) {
    super(`Invalid ActionType "${invalidAction}". Valid actions are: ${ACTION_TYPES.join(", ")}.`);
    this.name = "InvalidActionTypeError";
  }
}

/** Asserts that candidate is a valid ActionType, otherwise throws InvalidActionTypeError. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- 境界での型ガード関数
export function assertActionType(candidate: unknown): asserts candidate is ActionType {
  if (!isActionType(candidate)) {
    throw new InvalidActionTypeError(String(candidate));
  }
}

/** Action category sets for policy evaluation */
export const SHARED_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>(["READ_GRAPH"]);

export const ORCHESTRATOR_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "CLAIM_READY",
  "CLAIM_INTEGRATION",
  "ABANDON_ASSIGNMENT",
  "RESUME",
  "START_SESSION",
  "END_SESSION",
]);

export const PLANNER_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>(["APPLY_OPS"]);

export const WORKER_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "RECORD_RESULT",
  "SUBMIT_CANDIDATE",
  "FILE_MUTATION",
]);

export const INTEGRATOR_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "ADVANCE_INTEGRATION",
  "RECORD_INTEGRATION_OUTCOME",
]);

export const EXECUTOR_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "REQUEST_REPLAN",
]);

/** Category helper predicates */
export function isSharedAction(action: ActionType): boolean {
  return SHARED_ACTIONS.has(action);
}

export function isOrchestratorOnlyAction(action: ActionType): boolean {
  return ORCHESTRATOR_ONLY_ACTIONS.has(action);
}

export function isPlannerOnlyAction(action: ActionType): boolean {
  return PLANNER_ONLY_ACTIONS.has(action);
}

export function isWorkerOnlyAction(action: ActionType): boolean {
  return WORKER_ONLY_ACTIONS.has(action);
}

export function isIntegratorOnlyAction(action: ActionType): boolean {
  return INTEGRATOR_ONLY_ACTIONS.has(action);
}

export function isExecutorOnlyAction(action: ActionType): boolean {
  return EXECUTOR_ONLY_ACTIONS.has(action);
}
