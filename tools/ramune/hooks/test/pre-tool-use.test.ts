import { describe, expect, it } from "vitest";
import { runPreToolUseHook } from "../src/pre-tool-use.ts";
import type { RawPreToolUseInput } from "../src/role.ts";
import { readDocumentedDenyReason } from "./support/deny-output.ts";

// `runHook`（ramune モードのゲートと canonical graph locator を踏んだエントリ
// ポイント）のテストは run-hook.test.ts に分離している。eslint/max-lines
// （1ファイルあたりの許容行数）に収めるためと、`runPreToolUseHook`
// （role/policy を常に fail-closed で適用する）と `runHook`（その手前で
// canonical graph の稼働判定を行う）とで検証したい公開契約が異なるため。
//
// 「PreToolUse hook の拒否出力の形」の検証（公式ドキュメント
// https://code.claude.com/docs/en/hooks が示す形。2026-08-08 に ax で取得した
// 例をそのまま踏襲する）は run-hook.test.ts と共有するため
// support/deny-output.ts に切り出している。

function rawInput(overrides: RawPreToolUseInput = {}): string {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    ...overrides,
  });
}

const ALLOW_CASES = [
  {
    name: "orchestrator が ramune_read_graph を呼ぶ",
    input: rawInput({ tool_name: "mcp__ramune__ramune_read_graph" }),
  },
  {
    name: "orchestrator が ramune_claim_ready を呼ぶ",
    input: rawInput({ tool_name: "mcp__ramune__ramune_claim_ready" }),
  },
  {
    name: "orchestrator が ramune_resume を呼ぶ",
    input: rawInput({ tool_name: "mcp__ramune__ramune_resume" }),
  },
  {
    name: "planner が ramune_apply_ops を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_apply_ops",
      agent_id: "a1",
      agent_type: "planner",
    }),
  },
  {
    name: "worker が ramune_record_result を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_record_result",
      agent_id: "a2",
      agent_type: "worker",
    }),
  },
  {
    name: "worker が ramune_submit_candidate を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_submit_candidate",
      agent_id: "a2",
      agent_type: "worker",
    }),
  },
  {
    name: "worker が ramune_request_replan を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_request_replan",
      agent_id: "a2",
      agent_type: "worker",
    }),
  },
  {
    name: "worker が Edit を呼ぶ",
    input: rawInput({ tool_name: "Edit", agent_id: "a2", agent_type: "worker" }),
  },
  {
    name: "integrator が ramune_advance_integration を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_advance_integration",
      agent_id: "a3",
      agent_type: "integrator",
    }),
  },
  {
    name: "integrator が ramune_record_integration_outcome を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_record_integration_outcome",
      agent_id: "a3",
      agent_type: "integrator",
    }),
  },
  {
    name: "integrator が ramune_request_replan を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_request_replan",
      agent_id: "a3",
      agent_type: "integrator",
    }),
  },
] as const;

describe("runPreToolUseHook: allow（何も出力しない）", () => {
  it.each(ALLOW_CASES)("$name ケースは空文字列を返す（通常の権限フローに委譲）", ({ input }) => {
    expect.hasAssertions();
    expect(runPreToolUseHook(input)).toBe("");
  });
});

const POLICY_VIOLATION_CASES = [
  {
    name: "orchestrator が ramune_apply_ops を呼ぶ",
    input: rawInput({ tool_name: "mcp__ramune__ramune_apply_ops" }),
    expectedMention: /planner/u,
  },
  {
    name: "orchestrator が Edit を呼ぶ",
    input: rawInput({ tool_name: "Edit" }),
    expectedMention: /worker/u,
  },
  {
    name: "orchestrator が ramune_record_result を呼ぶ",
    input: rawInput({ tool_name: "mcp__ramune__ramune_record_result" }),
    expectedMention: /worker/u,
  },
  {
    name: "orchestrator が ramune_advance_integration を呼ぶ",
    input: rawInput({ tool_name: "mcp__ramune__ramune_advance_integration" }),
    expectedMention: /integrator/u,
  },
  {
    name: "planner が Edit を呼ぶ",
    input: rawInput({ tool_name: "Edit", agent_id: "a1", agent_type: "planner" }),
    expectedMention: /Worker/u,
  },
  {
    name: "planner が ramune_record_result を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_record_result",
      agent_id: "a1",
      agent_type: "planner",
    }),
    expectedMention: /Worker/u,
  },
  {
    name: "planner が ramune_claim_ready を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_claim_ready",
      agent_id: "a1",
      agent_type: "planner",
    }),
    expectedMention: /Orchestrator/u,
  },
  {
    name: "worker が ramune_apply_ops を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_apply_ops",
      agent_id: "a2",
      agent_type: "worker",
    }),
    expectedMention: /planner/u,
  },
  {
    name: "worker が ramune_record_integration_outcome を呼ぶ",
    input: rawInput({
      tool_name: "mcp__ramune__ramune_record_integration_outcome",
      agent_id: "a2",
      agent_type: "worker",
    }),
    expectedMention: /integrator/u,
  },
];

describe("runPreToolUseHook: ポリシー違反は deny JSON を返す", () => {
  it.each(POLICY_VIOLATION_CASES)(
    "$name ケースは deny JSON を返し、次に何をすべきかが分かる理由を含む",
    ({ input, expectedMention }) => {
      expect.hasAssertions();
      const output = runPreToolUseHook(input);
      const permissionDecisionReason = readDocumentedDenyReason(output);
      expect(permissionDecisionReason).toMatch(expectedMention);
    },
  );
});

describe("runPreToolUseHook: 削除された ramune_next_node は deny になる", () => {
  it("ramune_next_node はポリシー定義が削除済みのため、どのロールでも deny JSON を返す", () => {
    expect.hasAssertions();
    const output = runPreToolUseHook(rawInput({ tool_name: "mcp__ramune__ramune_next_node" }));
    const permissionDecisionReason = readDocumentedDenyReason(output);
    // UnknownToolError が fail-open にならず拒否へ変換されていること。
    // 理由文言には未定義ツールとして扱われた痕跡（ツール名）が残る。
    expect(permissionDecisionReason).toMatch(/ramune_next_node/u);
  });
});

describe("runPreToolUseHook: 未知の agent_type は fail-closed で deny になる", () => {
  it("agent_type が ramune の知らないサブエージェント名の場合、どのツールでも deny される", () => {
    expect.hasAssertions();
    const output = runPreToolUseHook(
      rawInput({
        tool_name: "mcp__ramune__ramune_read_graph",
        agent_id: "a3",
        agent_type: "custom-worker",
      }),
    );
    const permissionDecisionReason = readDocumentedDenyReason(output);
    expect(permissionDecisionReason.length).toBeGreaterThan(0);
    expect(permissionDecisionReason).toMatch(/custom-worker/u);
  });
});

describe("runPreToolUseHook: ロール判定不能・ポリシー未定義は例外を投げずに deny へ変換する", () => {
  it.each([
    { name: "stdin が不正な JSON", input: "{not json" },
    { name: "hook_event_name が想定外", input: rawInput({ hook_event_name: "PostToolUse" }) },
    { name: "tool_name が欠落", input: rawInput({ tool_name: undefined }) },
    { name: "agent_id が文字列以外", input: rawInput({ agent_id: 1 }) },
    { name: "agent_type が文字列以外", input: rawInput({ agent_type: 1 }) },
    { name: "ポリシーに定義のないツール", input: rawInput({ tool_name: "SomeUnlistedTool" }) },
  ])("$name の場合、例外を外に投げず deny JSON を返す（fail-open にしない）", ({ input }) => {
    expect.hasAssertions();
    let output = "";
    expect(() => {
      output = runPreToolUseHook(input);
    }).not.toThrow();
    const permissionDecisionReason = readDocumentedDenyReason(output);
    expect(permissionDecisionReason.length).toBeGreaterThan(0);
  });
});
