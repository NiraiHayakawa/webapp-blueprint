import {
  type ActionType,
  EXECUTOR_ONLY_ACTIONS,
  INTEGRATOR_ONLY_ACTIONS,
  isActionType,
  ORCHESTRATOR_ONLY_ACTIONS,
  PLANNER_ONLY_ACTIONS,
  SHARED_ACTIONS,
  WORKER_ONLY_ACTIONS,
} from "./actions.ts";
import { type Role, isRole } from "./role.ts";

export type Decision =
  | { readonly decision: "allow" }
  | { readonly decision: "deny"; readonly reason: string };

export class UnknownActionError extends Error {
  constructor(action: string) {
    super(
      `ramune のツール権限ポリシーにアクション "${action}" のルールが定義されていません。` +
        `tools/ramune/hooks/src/core/policy.ts に追加してください。`,
    );
    this.name = "UnknownActionError";
  }
}

function plannerOnlyDenyReason(action: ActionType, role: Role): string {
  if (role === "orchestrator") {
    return (
      `グラフの構造を変更できるのは planner サブエージェントだけです（${action} は Planner 専用です）。` +
      `planner を起動してください。`
    );
  }

  return (
    `${role} サブエージェントはグラフの構造を変更できません（${action} は Planner 専用です）。` +
    `構造の変更が必要なら結果に理由を書いて planner に差し戻してください。`
  );
}

function workerOnlyDenyReason(action: ActionType, role: Role): string {
  const isResultAction = action !== "FILE_MUTATION";

  if (role === "orchestrator") {
    return isResultAction
      ? `ノードの作業報告（candidate の提出を含む）ができるのは worker サブエージェントだけです` +
          `（${action} は Worker 専用です）。worker を起動してください。`
      : `ツールを実行して実装作業を行えるのは worker サブエージェントだけです` +
          `（${action} は Worker 専用です）。worker を起動してください。`;
  }

  return isResultAction
    ? `${role} はノードの作業報告を記録できません（${action} は Worker 専用です）。` +
        `作業報告は、そのノードを実行した Worker（subagent）に行わせてください。`
    : `${role} はツールを実行できません（${action} は Worker 専用です）。` +
        `実装作業は Worker（subagent）に委譲してください。`;
}

function integratorOnlyDenyReason(action: ActionType, role: Role): string {
  if (role === "orchestrator") {
    return (
      `統合工程の前進と成否の記録ができるのは integrator サブエージェントだけです` +
      `（${action} は Integrator 専用です）。integrator を起動してください。`
    );
  }

  return (
    `${role} は統合工程を操作できません（${action} は Integrator 専用です）。` +
    `統合は integrator サブエージェントに行わせてください。`
  );
}

function executorOnlyDenyReason(action: ActionType, role: Role): string {
  if (role === "orchestrator") {
    return (
      `ノードを blocked にして差し戻せるのは実行役のサブエージェント（worker / integrator）だけです` +
      `（${action}）。worker か integrator を起動してください。`
    );
  }

  return (
    `Planner 自身は ${action} を呼べません` +
    `（実行役が詰まったときに実行役自身が呼ぶ信号です）。` +
    `blocked のノードが無いか READ_GRAPH で確認し、あれば理由を読んで計画を修正してください。`
  );
}

function orchestratorOnlyDenyReason(action: ActionType): string {
  return (
    `${action} は Orchestrator 専用です。セッションへの出入り（START_SESSION / END_SESSION）と` +
    `assignment の発行・回復（claim / resume / abandon）は、Planner / Worker / Integrator の` +
    `サブエージェントではなく Orchestrator が直接行います。`
  );
}

interface RestrictedActionCheck {
  readonly action: ActionType;
  readonly role: Role;
  readonly requiredRole: Role;
  readonly denyReason: (action: ActionType, role: Role) => string;
}

function decideForRestrictedAction(check: RestrictedActionCheck): Decision {
  return check.role === check.requiredRole
    ? { decision: "allow" }
    : { decision: "deny", reason: check.denyReason(check.action, check.role) };
}

function decideForExecutorAction(action: ActionType, role: Role): Decision {
  if (role === "worker" || role === "integrator") {
    return { decision: "allow" };
  }
  return { decision: "deny", reason: executorOnlyDenyReason(action, role) };
}

interface ActionRule {
  readonly actions: ReadonlySet<ActionType>;
  readonly decide: (action: ActionType, role: Role) => Decision;
}

const ACTION_RULES: readonly ActionRule[] = [
  { actions: SHARED_ACTIONS, decide: () => ({ decision: "allow" }) },
  {
    actions: PLANNER_ONLY_ACTIONS,
    decide: (action, role) =>
      decideForRestrictedAction({
        action,
        role,
        requiredRole: "planner",
        denyReason: plannerOnlyDenyReason,
      }),
  },
  {
    actions: WORKER_ONLY_ACTIONS,
    decide: (action, role) =>
      decideForRestrictedAction({
        action,
        role,
        requiredRole: "worker",
        denyReason: workerOnlyDenyReason,
      }),
  },
  {
    actions: INTEGRATOR_ONLY_ACTIONS,
    decide: (action, role) =>
      decideForRestrictedAction({
        action,
        role,
        requiredRole: "integrator",
        denyReason: integratorOnlyDenyReason,
      }),
  },
  { actions: EXECUTOR_ONLY_ACTIONS, decide: decideForExecutorAction },
  {
    actions: ORCHESTRATOR_ONLY_ACTIONS,
    decide: (action, role) =>
      decideForRestrictedAction({
        action,
        role,
        requiredRole: "orchestrator",
        denyReason: (act) => orchestratorOnlyDenyReason(act),
      }),
  },
];

/**
 * Pure policy evaluator for ramune.
 * Evaluates whether a given Role is permitted to execute an ActionType.
 * Returns { decision: "allow" } or { decision: "deny", reason: string }.
 * Throws UnknownActionError if action or role is not recognized.
 */
export function evaluatePolicy(action: ActionType, role: Role): Decision {
  if (!isActionType(action)) {
    throw new UnknownActionError(String(action));
  }
  if (!isRole(role)) {
    throw new UnknownActionError(`Invalid role: ${String(role)}`);
  }

  const rule = ACTION_RULES.find((candidate) => candidate.actions.has(action));
  if (rule === undefined) {
    throw new UnknownActionError(action);
  }
  return rule.decide(action, role);
}
