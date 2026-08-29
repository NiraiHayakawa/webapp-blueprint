import { UnknownToolError, resolveDecision } from "../src/policy.ts";
import { describe, expect, it } from "vitest";
import type { Role } from "../src/role.ts";

const ROLES: readonly Role[] = ["orchestrator", "planner", "worker", "integrator"];

/**
 * Claude Code は MCP ツールの `tool_name` を `mcp__<server名>__<tool名>` という
 * prefix 付きの文字列で PreToolUse hook の stdin に渡す（`.claude/settings.json`
 * の matcher が `mcp__ramune__ramune_read_graph` のように書かれているのはこの実測
 * に基づく）。`resolveDecision` が実際に受け取るのはこの prefix 付きの値であり、
 * bare 名（`ramune_read_graph` 等）ではない。ビルトインツール（`Edit`/`Write`）
 * は prefix が付かないため bare のままでよい。
 *
 * ツール一覧とロール列は設計正本（docs/plan/Ramune/20260824_parallel-execution.md
 * §8）の表そのもの。`ramune_next_node` は削除済みで互換エントリを残さない。
 */
const KNOWN_TOOLS = [
  "mcp__ramune__ramune_read_graph",
  "mcp__ramune__ramune_claim_ready",
  "mcp__ramune__ramune_claim_integration",
  "mcp__ramune__ramune_abandon_assignment",
  "mcp__ramune__ramune_resume",
  "mcp__ramune__ramune_start",
  "mcp__ramune__ramune_end",
  "mcp__ramune__ramune_apply_ops",
  "mcp__ramune__ramune_record_result",
  "mcp__ramune__ramune_submit_candidate",
  "mcp__ramune__ramune_request_replan",
  "mcp__ramune__ramune_advance_integration",
  "mcp__ramune__ramune_record_integration_outcome",
  "Edit",
  "Write",
] as const;

/**
 * ロール × ツールの全組み合わせに対する期待値（設計正本 §8 の表そのもの）。
 * Orchestrator は claim / resume / abandon / セッション出入りだけを行い、
 * 構造変更は Planner、作業報告は Worker、統合工程は Integrator が担う。
 */
const EXPECTED_ALLOWED: ReadonlySet<string> = new Set([
  "orchestrator:mcp__ramune__ramune_read_graph",
  "orchestrator:mcp__ramune__ramune_claim_ready",
  "orchestrator:mcp__ramune__ramune_claim_integration",
  "orchestrator:mcp__ramune__ramune_abandon_assignment",
  "orchestrator:mcp__ramune__ramune_resume",
  "orchestrator:mcp__ramune__ramune_start",
  "orchestrator:mcp__ramune__ramune_end",
  "planner:mcp__ramune__ramune_read_graph",
  "planner:mcp__ramune__ramune_apply_ops",
  "worker:mcp__ramune__ramune_read_graph",
  "worker:mcp__ramune__ramune_record_result",
  "worker:mcp__ramune__ramune_submit_candidate",
  "worker:mcp__ramune__ramune_request_replan",
  "worker:Edit",
  "worker:Write",
  "integrator:mcp__ramune__ramune_read_graph",
  "integrator:mcp__ramune__ramune_advance_integration",
  "integrator:mcp__ramune__ramune_record_integration_outcome",
  "integrator:mcp__ramune__ramune_request_replan",
]);

const cases = ROLES.flatMap((role) =>
  KNOWN_TOOLS.map((toolName) => ({
    role,
    toolName,
    expectAllow: EXPECTED_ALLOWED.has(`${role}:${toolName}`),
  })),
);

// ramune_start / ramune_end 等の Orchestrator 専用ツールの拒否理由は「Orchestrator
// に委ねること」を案内するため、サブエージェントへの言及を必須にする「次の行動」
// チェックの対象外にする（別途 "Orchestrator に委ねることを案内する" ケースで
// 検証する）。eslint/max-lines-per-function に収めるため describe を分けており、
// この定数はどちらの describe 本体にも含めずここに置く。
const ORCHESTRATOR_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "mcp__ramune__ramune_claim_ready",
  "mcp__ramune__ramune_claim_integration",
  "mcp__ramune__ramune_abandon_assignment",
  "mcp__ramune__ramune_resume",
  "mcp__ramune__ramune_start",
  "mcp__ramune__ramune_end",
]);

describe("resolveDecision: ロール × ツールの全組み合わせ（table-driven）", () => {
  it.each(cases)(
    "role=$role, tool=$toolName は allow=$expectAllow になる",
    ({ role, toolName, expectAllow }) => {
      expect.hasAssertions();
      const decision = resolveDecision(toolName, role);
      expect(decision.kind).toBe(expectAllow ? "allow" : "deny");
    },
  );

  it("ramune_read_graph は全ロールいずれでも許可される", () => {
    expect.hasAssertions();
    for (const role of ROLES) {
      expect(resolveDecision("mcp__ramune__ramune_read_graph", role).kind).toBe("allow");
    }
  });

  it("ramune_request_replan は実行役（worker / integrator）に許可され、それ以外は拒否される", () => {
    expect.hasAssertions();
    expect(resolveDecision("mcp__ramune__ramune_request_replan", "worker").kind).toBe("allow");
    expect(resolveDecision("mcp__ramune__ramune_request_replan", "integrator").kind).toBe("allow");
    expect(resolveDecision("mcp__ramune__ramune_request_replan", "planner").kind).toBe("deny");
    expect(resolveDecision("mcp__ramune__ramune_request_replan", "orchestrator").kind).toBe("deny");
  });
});

describe("resolveDecision: 削除された ramune_next_node は互換エントリ無しで拒否される", () => {
  it("ramune_next_node はどのロールにも定義がなく UnknownToolError を投げる", () => {
    expect.hasAssertions();
    for (const role of ROLES) {
      expect(() => resolveDecision("mcp__ramune__ramune_next_node", role)).toThrow(
        UnknownToolError,
      );
    }
  });
});

describe("resolveDecision: 拒否理由の文言(次に何をすべきかが分かること)", () => {
  it.each(
    cases.filter((entry) => !entry.expectAllow && !ORCHESTRATOR_ONLY_TOOLS.has(entry.toolName)),
  )(
    "role=$role, tool=$toolName の拒否理由は次の行動（誰に委ねるべきか）を含む",
    ({ role, toolName }) => {
      expect.hasAssertions();
      const decision = resolveDecision(toolName, role);
      if (decision.kind !== "deny") {
        throw new Error("この分岐は deny のはずが allow だった（テストケース定義の矛盾）");
      }
      expect(decision.reason.length).toBeGreaterThan(0);
      // 「なぜ拒否されたか」だけでなく「次に何をすべきか」が分かる文言であること
      // （ramune のタスク仕様の要件）。委ね先の役割名を必須にする。
      expect(decision.reason).toMatch(/Planner|Worker|Integrator|planner|worker|integrator/u);
    },
  );

  it.each(
    cases.filter((entry) => !entry.expectAllow && ORCHESTRATOR_ONLY_TOOLS.has(entry.toolName)),
  )(
    "role=$role, tool=$toolName の拒否理由は Orchestrator に委ねることを案内する",
    ({ role, toolName }) => {
      expect.hasAssertions();
      const decision = resolveDecision(toolName, role);
      if (decision.kind !== "deny") {
        throw new Error("この分岐は deny のはずが allow だった（テストケース定義の矛盾）");
      }
      expect(decision.reason).toMatch(/Orchestrator/u);
    },
  );
});

describe("resolveDecision: Orchestrator が拒否されたときの案内文（誰を起動すべきか）", () => {
  it("orchestrator は ramune_apply_ops を拒否され、planner を起動するよう案内される", () => {
    expect.hasAssertions();
    const decision = resolveDecision("mcp__ramune__ramune_apply_ops", "orchestrator");
    if (decision.kind !== "deny") {
      throw new Error("orchestrator の ramune_apply_ops は deny のはず");
    }
    expect(decision.reason).toMatch(/planner/u);
  });

  it("orchestrator は ramune_record_result / submit_candidate / Edit / Write を拒否され、worker を起動するよう案内される", () => {
    expect.hasAssertions();
    for (const toolName of [
      "mcp__ramune__ramune_record_result",
      "mcp__ramune__ramune_submit_candidate",
      "Edit",
      "Write",
    ]) {
      const decision = resolveDecision(toolName, "orchestrator");
      if (decision.kind !== "deny") {
        throw new Error(`orchestrator の ${toolName} は deny のはず`);
      }
      expect(decision.reason).toMatch(/worker/u);
    }
  });

  it("orchestrator は ramune_advance_integration / record_integration_outcome を拒否され、integrator を起動するよう案内される", () => {
    expect.hasAssertions();
    for (const toolName of [
      "mcp__ramune__ramune_advance_integration",
      "mcp__ramune__ramune_record_integration_outcome",
    ]) {
      const decision = resolveDecision(toolName, "orchestrator");
      if (decision.kind !== "deny") {
        throw new Error(`orchestrator の ${toolName} は deny のはず`);
      }
      expect(decision.reason).toMatch(/integrator/u);
    }
  });
});

describe("resolveDecision: 未定義ツールは UnknownToolError を投げる（判定不能は拒否側に倒す）", () => {
  it.each([
    { name: "定義されていないツール名", toolName: "SomeUnlistedTool" },
    { name: "ramune_apply_ops のタイポ", toolName: "mcp__ramune__ramune_apply_op" },
    { name: "空文字列", toolName: "" },
    {
      name: "prefix なしの bare 名（Claude Code は MCP ツールに必ず mcp__<server>__ prefix を付けるため未対応）",
      toolName: "ramune_apply_ops",
    },
  ])("$name（$toolName）は UnknownToolError を投げる", ({ toolName }) => {
    expect.hasAssertions();
    for (const role of ROLES) {
      expect(() => resolveDecision(toolName, role)).toThrow(UnknownToolError);
    }
  });
});
