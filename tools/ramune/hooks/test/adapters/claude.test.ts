import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeInputParseError,
  formatClaudeAllow,
  formatClaudeDecision,
  formatClaudeDeny,
  mapClaudeToolToAction,
  parseClaudeInput,
  resolveClaudeRole,
  runClaudeHook,
} from "../../src/adapters/claude/index.ts";
import { UnknownActionError } from "../../src/core/policy.ts";
import { createCanonicalRepo, v2GraphJson, writeGraphFile } from "../support/fake-repo.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-claude-test", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });

describe("Claude Adapter: Schema Parsing", () => {
  it("valid snake_case payload parses correctly", () => {
    const raw = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__ramune__ramune_apply_ops",
      agent_type: "planner",
      agent_id: "agent-123",
      session_id: "session-abc",
    });

    const parsed = parseClaudeInput(raw);
    expect(parsed.toolName).toBe("mcp__ramune__ramune_apply_ops");
    expect(parsed.agentType).toBe("planner");
    expect(parsed.agentId).toBe("agent-123");
    expect(parsed.hookEventName).toBe("PreToolUse");
    expect(parsed.sessionId).toBe("session-abc");
  });

  it.each([
    { name: "invalid JSON", input: "{broken json" },
    { name: "array root", input: JSON.stringify(["item-1", "item-2"]) },
    { name: "primitive number", input: "123" },
    { name: "missing tool_name", input: JSON.stringify({ hook_event_name: "PreToolUse" }) },
    {
      name: "empty tool_name",
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "" }),
    },
    {
      name: "non-string agent_type",
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", agent_type: 123 }),
    },
    {
      name: "non-string agent_id",
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", agent_id: {} }),
    },
    {
      name: "non-string session_id",
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", session_id: [] }),
    },
  ])("malformed input ($name) throws ClaudeInputParseError", ({ input }) => {
    expect(() => parseClaudeInput(input)).toThrow(ClaudeInputParseError);
  });
});

describe("Claude Adapter: Role Resolution", () => {
  it.each([
    { agentType: undefined, expectedRole: "orchestrator" },
    { agentType: "planner", expectedRole: "planner" },
    { agentType: "worker", expectedRole: "worker" },
    { agentType: "integrator", expectedRole: "integrator" },
  ] as const)("agent_type=$agentType resolves to $expectedRole", ({ agentType, expectedRole }) => {
    const input = parseClaudeInput(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        agent_type: agentType,
      }),
    );
    expect(resolveClaudeRole(input)).toBe(expectedRole);
  });

  it("unknown agent_type throws ClaudeInputParseError", () => {
    const input = parseClaudeInput(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        agent_type: "unknown-subagent",
      }),
    );
    expect(() => resolveClaudeRole(input)).toThrow(ClaudeInputParseError);
  });
});

describe("Claude Adapter: Tool Mapping", () => {
  it.each([
    { toolName: "mcp__ramune__ramune_read_graph", expectedAction: "READ_GRAPH" },
    { toolName: "mcp__ramune__ramune_claim_ready", expectedAction: "CLAIM_READY" },
    { toolName: "mcp__ramune__ramune_claim_integration", expectedAction: "CLAIM_INTEGRATION" },
    { toolName: "mcp__ramune__ramune_abandon_assignment", expectedAction: "ABANDON_ASSIGNMENT" },
    { toolName: "mcp__ramune__ramune_resume", expectedAction: "RESUME" },
    { toolName: "mcp__ramune__ramune_start", expectedAction: "START_SESSION" },
    { toolName: "mcp__ramune__ramune_end", expectedAction: "END_SESSION" },
    { toolName: "mcp__ramune__ramune_apply_ops", expectedAction: "APPLY_OPS" },
    { toolName: "mcp__ramune__ramune_record_result", expectedAction: "RECORD_RESULT" },
    { toolName: "mcp__ramune__ramune_submit_candidate", expectedAction: "SUBMIT_CANDIDATE" },
    { toolName: "mcp__ramune__ramune_request_replan", expectedAction: "REQUEST_REPLAN" },
    { toolName: "mcp__ramune__ramune_advance_integration", expectedAction: "ADVANCE_INTEGRATION" },
    {
      toolName: "mcp__ramune__ramune_record_integration_outcome",
      expectedAction: "RECORD_INTEGRATION_OUTCOME",
    },
    { toolName: "Edit", expectedAction: "FILE_MUTATION" },
    { toolName: "Write", expectedAction: "FILE_MUTATION" },
  ] as const)("toolName=$toolName maps to $expectedAction", ({ toolName, expectedAction }) => {
    expect(mapClaudeToolToAction(toolName)).toBe(expectedAction);
  });

  it("unknown tool throws UnknownActionError", () => {
    expect(() => mapClaudeToolToAction("unknown_tool")).toThrow(UnknownActionError);
  });
});

describe("Claude Adapter: Formatter", () => {
  it("formatClaudeAllow returns empty string", () => {
    expect(formatClaudeAllow()).toBe("");
  });

  it("formatClaudeDeny returns valid Claude hookSpecificOutput JSON", () => {
    const denyJson = formatClaudeDeny("Access denied");
    expect(JSON.parse(denyJson)).toStrictEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Access denied",
      },
    });
  });

  it("formatClaudeDecision formats correctly", () => {
    expect(formatClaudeDecision({ decision: "allow" })).toBe("");
    const denyResult = formatClaudeDecision({ decision: "deny", reason: "Blocked" });
    expect(JSON.parse(denyResult)).toStrictEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Blocked",
      },
    });
  });
});

describe("Claude Adapter: Runner Pipeline", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-claude-test-"));
    repoRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("active session enforces role permissions", () => {
    writeGraphFile(repoRoot, ACTIVE_GRAPH);

    const orchEdit = runClaudeHook(
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit" }),
      repoRoot,
    );
    expect(orchEdit).toContain("worker");

    const workerEdit = runClaudeHook(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        agent_type: "worker",
      }),
      repoRoot,
    );
    expect(workerEdit).toBe("");
  });

  it("inactive session allows all tools", () => {
    writeGraphFile(repoRoot, INACTIVE_GRAPH);

    const orchEdit = runClaudeHook(
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit" }),
      repoRoot,
    );
    expect(orchEdit).toBe("");
  });

  it("malformed payload fails closed with deny output", () => {
    writeGraphFile(repoRoot, ACTIVE_GRAPH);

    const result = runClaudeHook("{broken json", repoRoot);
    expect(result).toContain("deny");
  });
});
