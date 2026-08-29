import {
  HookInputParseError,
  determineRole,
  parsePreToolUseHookInput,
  type RawPreToolUseInput,
} from "../src/role.ts";
import { describe, expect, it } from "vitest";

function rawInput(overrides: RawPreToolUseInput = {}): string {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    ...overrides,
  });
}

describe("parsePreToolUseHookInput + determineRole: agent_type からロールを判定する", () => {
  it.each([
    {
      name: "agent_type が無い（メインエージェント）",
      overrides: {},
      expectedRole: "orchestrator",
    },
    {
      name: "agent_id だけがある（agent_type は無い）",
      overrides: { agent_id: "agent-123" },
      expectedRole: "orchestrator",
    },
    {
      name: 'agent_type が "planner"',
      overrides: { agent_id: "agent-123", agent_type: "planner" },
      expectedRole: "planner",
    },
    {
      name: 'agent_type が "worker"',
      overrides: { agent_id: "agent-456", agent_type: "worker" },
      expectedRole: "worker",
    },
    {
      name: 'agent_type が "integrator"',
      overrides: { agent_id: "agent-789", agent_type: "integrator" },
      expectedRole: "integrator",
    },
  ] as const)("$name の入力は $expectedRole と判定される", ({ overrides, expectedRole }) => {
    expect.hasAssertions();
    const input = parsePreToolUseHookInput(rawInput(overrides));
    expect(determineRole(input)).toBe(expectedRole);
  });

  it("agent_type が未知のサブエージェント名の入力は HookInputParseError を投げる（fail-fast）", () => {
    expect.hasAssertions();
    const input = parsePreToolUseHookInput(
      rawInput({ agent_id: "agent-789", agent_type: "custom-worker" }),
    );
    expect(() => determineRole(input)).toThrow(HookInputParseError);
  });
});

describe("parsePreToolUseHookInput: tool_name をそのまま保持する", () => {
  it("tool_name をそのまま保持する", () => {
    expect.hasAssertions();
    const input = parsePreToolUseHookInput(rawInput({ tool_name: "ramune_apply_ops" }));
    expect(input.toolName).toBe("ramune_apply_ops");
  });
});

describe("parsePreToolUseHookInput: 解析できない入力は HookInputParseError を投げる（fail-fast）", () => {
  it.each([
    { name: "不正な JSON", raw: "{not json" },
    { name: "トップレベルが配列", raw: JSON.stringify([1, 2]) },
    { name: "トップレベルが null", raw: "null" },
    { name: "hook_event_name が欠落", raw: rawInput({ hook_event_name: undefined }) },
    { name: "hook_event_name が別イベント", raw: rawInput({ hook_event_name: "PostToolUse" }) },
    { name: "tool_name が欠落", raw: rawInput({ tool_name: undefined }) },
    { name: "tool_name が空文字列", raw: rawInput({ tool_name: "" }) },
    { name: "tool_name が数値", raw: rawInput({ tool_name: 1 }) },
    { name: "agent_id が数値", raw: rawInput({ agent_id: 42 }) },
    { name: "agent_id がオブジェクト", raw: rawInput({ agent_id: {} }) },
    { name: "agent_type が数値", raw: rawInput({ agent_type: 1 }) },
    { name: "agent_type がオブジェクト", raw: rawInput({ agent_type: {} }) },
  ])("$name の入力は HookInputParseError を投げる", ({ raw }) => {
    expect.hasAssertions();
    expect(() => parsePreToolUseHookInput(raw)).toThrow(HookInputParseError);
  });
});
