import {
  ACTION_TYPES,
  type ActionType,
  InvalidActionTypeError,
  assertActionType,
  isActionType,
  isExecutorOnlyAction,
  isIntegratorOnlyAction,
  isOrchestratorOnlyAction,
  isPlannerOnlyAction,
  isSharedAction,
  isWorkerOnlyAction,
} from "../../src/core/actions.ts";
import {
  ROLES,
  type Role,
  RoleValidationError,
  assertRole,
  isExecutorRole,
  isIntegratorRole,
  isOrchestratorRole,
  isPlannerRole,
  isRole,
  isSubagentRole,
  isWorkerRole,
} from "../../src/core/role.ts";
import { UnknownActionError, evaluatePolicy } from "../../src/core/policy.ts";
import { describe, expect, it } from "vitest";

/**
 * Expected Allowed Matrix (18 combinations):
 * - Orchestrator (7): READ_GRAPH, CLAIM_READY, CLAIM_INTEGRATION, ABANDON_ASSIGNMENT, RESUME, START_SESSION, END_SESSION
 * - Planner (2): READ_GRAPH, APPLY_OPS
 * - Worker (5): READ_GRAPH, RECORD_RESULT, SUBMIT_CANDIDATE, REQUEST_REPLAN, FILE_MUTATION
 * - Integrator (4): READ_GRAPH, ADVANCE_INTEGRATION, RECORD_INTEGRATION_OUTCOME, REQUEST_REPLAN
 */
const EXPECTED_ALLOWED: ReadonlySet<string> = new Set([
  "orchestrator:READ_GRAPH",
  "orchestrator:CLAIM_READY",
  "orchestrator:CLAIM_INTEGRATION",
  "orchestrator:ABANDON_ASSIGNMENT",
  "orchestrator:RESUME",
  "orchestrator:START_SESSION",
  "orchestrator:END_SESSION",
  "planner:READ_GRAPH",
  "planner:APPLY_OPS",
  "worker:READ_GRAPH",
  "worker:RECORD_RESULT",
  "worker:SUBMIT_CANDIDATE",
  "worker:REQUEST_REPLAN",
  "worker:FILE_MUTATION",
  "integrator:READ_GRAPH",
  "integrator:ADVANCE_INTEGRATION",
  "integrator:RECORD_INTEGRATION_OUTCOME",
  "integrator:REQUEST_REPLAN",
]);

interface PolicyTestCase {
  readonly role: Role;
  readonly action: ActionType;
  readonly expectedDecision: "allow" | "deny";
}

const ALL_COMBINATION_CASES: readonly PolicyTestCase[] = ROLES.flatMap((role) =>
  ACTION_TYPES.map((action) => ({
    role,
    action,
    expectedDecision: EXPECTED_ALLOWED.has(`${role}:${action}`) ? "allow" : "deny",
  })),
);

const ORCHESTRATOR_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "CLAIM_READY",
  "CLAIM_INTEGRATION",
  "ABANDON_ASSIGNMENT",
  "RESUME",
  "START_SESSION",
  "END_SESSION",
]);

const DENIED_CASES = ALL_COMBINATION_CASES.filter((c) => c.expectedDecision === "deny");

describe("evaluatePolicy: 全14アクション × 4ロールの決定マトリクス（56パターン）", () => {
  it.each(ALL_COMBINATION_CASES)(
    "action=$action, role=$role -> decision=$expectedDecision",
    ({ action, role, expectedDecision }) => {
      expect.hasAssertions();
      const decision = evaluatePolicy(action, role);
      expect(decision.decision).toBe(expectedDecision);
    },
  );

  it("READ_GRAPH は全4ロール（orchestrator, planner, worker, integrator）すべてで許可される", () => {
    expect.hasAssertions();
    for (const role of ROLES) {
      expect(evaluatePolicy("READ_GRAPH", role)).toStrictEqual({ decision: "allow" });
    }
  });

  it("REQUEST_REPLAN は実行役（worker / integrator）に許可され、orchestrator / planner には拒否される", () => {
    expect.hasAssertions();
    expect(evaluatePolicy("REQUEST_REPLAN", "worker")).toStrictEqual({ decision: "allow" });
    expect(evaluatePolicy("REQUEST_REPLAN", "integrator")).toStrictEqual({ decision: "allow" });
    expect(evaluatePolicy("REQUEST_REPLAN", "orchestrator").decision).toBe("deny");
    expect(evaluatePolicy("REQUEST_REPLAN", "planner").decision).toBe("deny");
  });
});

describe("evaluatePolicy: サブエージェント宛てガイダンス検証", () => {
  it.each(DENIED_CASES.filter((c) => !ORCHESTRATOR_ONLY_ACTIONS.has(c.action)))(
    "action=$action, role=$role の拒否理由は次の行動（誰に委ねるべきか）を含む",
    ({ action, role }) => {
      expect.hasAssertions();
      const decision = evaluatePolicy(action, role);
      if (decision.decision !== "deny") {
        throw new Error(`Expected deny for ${action} / ${role}`);
      }
      expect(decision.reason).toMatch(/Planner|Worker|Integrator|planner|worker|integrator/u);
    },
  );

  it.each(DENIED_CASES.filter((c) => ORCHESTRATOR_ONLY_ACTIONS.has(c.action)))(
    "action=$action, role=$role の拒否理由は Orchestrator に委ねることを案内する",
    ({ action, role }) => {
      expect.hasAssertions();
      const decision = evaluatePolicy(action, role);
      if (decision.decision !== "deny") {
        throw new Error(`Expected deny for ${action} / ${role}`);
      }
      expect(decision.reason).toMatch(/Orchestrator/u);
    },
  );
});

describe("evaluatePolicy: Orchestrator 拒否時の起動対象ガイダンス検証", () => {
  it("orchestrator が APPLY_OPS を呼んだときは planner を起動するよう案内される", () => {
    expect.hasAssertions();
    const decision = evaluatePolicy("APPLY_OPS", "orchestrator");
    if (decision.decision !== "deny") {
      throw new Error("Expected deny");
    }
    expect(decision.reason).toMatch(/planner/u);
  });

  it("orchestrator が FILE_MUTATION / RECORD_RESULT / SUBMIT_CANDIDATE を呼んだときは worker を起動するよう案内される", () => {
    expect.hasAssertions();
    for (const action of ["FILE_MUTATION", "RECORD_RESULT", "SUBMIT_CANDIDATE"] as const) {
      const decision = evaluatePolicy(action, "orchestrator");
      if (decision.decision !== "deny") {
        throw new Error(`Expected deny for ${action}`);
      }
      expect(decision.reason).toMatch(/worker/u);
    }
  });

  it("orchestrator が ADVANCE_INTEGRATION / RECORD_INTEGRATION_OUTCOME を呼んだときは integrator を起動するよう案内される", () => {
    expect.hasAssertions();
    for (const action of ["ADVANCE_INTEGRATION", "RECORD_INTEGRATION_OUTCOME"] as const) {
      const decision = evaluatePolicy(action, "orchestrator");
      if (decision.decision !== "deny") {
        throw new Error(`Expected deny for ${action}`);
      }
      expect(decision.reason).toMatch(/integrator/u);
    }
  });
});

describe("evaluatePolicy: 未知のアクションまたはロールは UnknownActionError を投げる", () => {
  it.each([
    { name: "未定義アクション名", action: "UNKNOWN_ACTION" },
    { name: "タイポしたアクション名", action: "READ_GRAPHS" },
    { name: "空文字列", action: "" },
    { name: "小文字のアクション名", action: "read_graph" },
  ])("$name（$action）は UnknownActionError を投げる", ({ action }) => {
    expect.hasAssertions();
    for (const role of ROLES) {
      // SAFETY: テスト目的で無効なアクション型を渡し、ポリシーカーネルが UnknownActionError を投げることを検証する
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const invalidAction = action as ActionType;
      expect(() => evaluatePolicy(invalidAction, role)).toThrow(UnknownActionError);
    }
  });

  it("未定義ロールは UnknownActionError を投げる", () => {
    expect.hasAssertions();
    // SAFETY: テスト目的で無効なロール型を渡し、ポリシーカーネルが UnknownActionError を投げることを検証する
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const invalidRole = "unknown_role" as Role;
    expect(() => evaluatePolicy("READ_GRAPH", invalidRole)).toThrow(UnknownActionError);
  });
});

describe("core/actions 型ガード・ヘルパー関数の検証", () => {
  it("isActionType は全14アクションで true を返し、無効値で false を返す", () => {
    expect.hasAssertions();
    for (const action of ACTION_TYPES) {
      expect(isActionType(action)).toBe(true);
    }
    expect(isActionType("INVALID")).toBe(false);
    expect(isActionType(0)).toBe(false);
    expect(isActionType(null)).toBe(false);
  });

  it("assertActionType は無効値で例外を投げる", () => {
    expect.hasAssertions();
    expect(() => {
      assertActionType("INVALID");
    }).toThrow(InvalidActionTypeError);
    expect(() => {
      assertActionType("READ_GRAPH");
    }).not.toThrow();
  });

  it("アクション分類ヘルパー（shared / orchestrator / planner）が正しく判定する", () => {
    expect.hasAssertions();
    expect(isSharedAction("READ_GRAPH")).toBe(true);
    expect(isOrchestratorOnlyAction("CLAIM_READY")).toBe(true);
    expect(isPlannerOnlyAction("APPLY_OPS")).toBe(true);
  });

  it("アクション分類ヘルパー（worker / integrator / executor）が正しく判定する", () => {
    expect.hasAssertions();
    expect(isWorkerOnlyAction("FILE_MUTATION")).toBe(true);
    expect(isIntegratorOnlyAction("ADVANCE_INTEGRATION")).toBe(true);
    expect(isExecutorOnlyAction("REQUEST_REPLAN")).toBe(true);
  });
});

describe("core/role 型ガード・ヘルパー関数の検証", () => {
  it("isRole は全4ロールで true を返し、無効値で false を返す", () => {
    expect.hasAssertions();
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
    expect(isRole("admin")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("assertRole は無効値で例外を投げる", () => {
    expect.hasAssertions();
    expect(() => {
      assertRole("admin");
    }).toThrow(RoleValidationError);
    expect(() => {
      assertRole("worker");
    }).not.toThrow();
  });

  it("ロール分類ヘルパー（個別ロール）が正しく判定する", () => {
    expect.hasAssertions();
    expect(isOrchestratorRole("orchestrator")).toBe(true);
    expect(isPlannerRole("planner")).toBe(true);
    expect(isWorkerRole("worker")).toBe(true);
    expect(isIntegratorRole("integrator")).toBe(true);
  });

  it("ロール分類ヘルパー（subagent / executor）が正しく判定する", () => {
    expect.hasAssertions();
    expect(isSubagentRole("worker")).toBe(true);
    expect(isSubagentRole("orchestrator")).toBe(false);
    expect(isExecutorRole("worker")).toBe(true);
    expect(isExecutorRole("planner")).toBe(false);
  });
});
