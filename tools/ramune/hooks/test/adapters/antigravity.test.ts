import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AntigravityInputParseError,
  formatAntigravityAllow,
  formatAntigravityDecision,
  formatAntigravityDeny,
  mapAntigravityToolToAction,
  parseAntigravityInput,
  resolveAntigravityRole,
  runAntigravityHook,
} from "../../src/adapters/antigravity/index.ts";
import { UnknownActionError } from "../../src/core/policy.ts";
import { createCanonicalRepo, v2GraphJson, writeGraphFile } from "../support/fake-repo.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-ag-test", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });

describe("Antigravity Adapter: Valid Schema Parsing", () => {
  it("valid toolCall payload parses correctly", () => {
    const raw = JSON.stringify({
      toolCall: {
        name: "mcp_ramune_apply_ops",
        args: { ops: [] },
      },
      subagent: {
        name: "planner",
        role: "planner",
      },
      conversationId: "conv-123",
      stepIdx: 0,
      workspacePaths: ["/workspace/dir"],
    });

    const parsed = parseAntigravityInput(raw);
    expect(parsed).toStrictEqual({
      toolName: "mcp_ramune_apply_ops",
      subagentRole: "planner",
      conversationId: "conv-123",
      stepIdx: 0,
      workspacePaths: ["/workspace/dir"],
      toolArgs: { ops: [] },
    });
  });

  it("valid tool_name fallback payload parses correctly", () => {
    const raw = JSON.stringify({
      tool_name: "write_to_file",
      agentType: "worker",
    });

    const parsed = parseAntigravityInput(raw);
    expect(parsed.toolName).toBe("write_to_file");
    expect(parsed.subagentRole).toBe("worker");
  });
});

describe("Antigravity Adapter: Malformed Schema Parsing", () => {
  it.each([
    { name: "invalid JSON", input: "{broken json" },
    { name: "array root", input: JSON.stringify(["item-1", "item-2"]) },
    { name: "primitive number", input: "123" },
    { name: "missing toolCall and tool_name", input: JSON.stringify({ subagent: {} }) },
    { name: "empty toolCall.name", input: JSON.stringify({ toolCall: { name: "" } }) },
    {
      name: "non-object subagent",
      input: JSON.stringify({ tool_name: "write_to_file", subagent: 123 }),
    },
  ])("malformed input ($name) throws AntigravityInputParseError", ({ input }) => {
    expect(() => parseAntigravityInput(input)).toThrow(AntigravityInputParseError);
  });
});

describe("Antigravity Adapter: Role Resolution", () => {
  it.each([
    { subagentRole: undefined, expectedRole: "orchestrator" },
    { subagentRole: "orchestrator", expectedRole: "orchestrator" },
    { subagentRole: "main", expectedRole: "orchestrator" },
    { subagentRole: "planner", expectedRole: "planner" },
    { subagentRole: "worker", expectedRole: "worker" },
    { subagentRole: "integrator", expectedRole: "integrator" },
  ] as const)(
    "subagentRole=$subagentRole resolves to $expectedRole",
    ({ subagentRole, expectedRole }) => {
      const input = parseAntigravityInput(
        JSON.stringify({
          tool_name: "write_to_file",
          agentType: subagentRole,
        }),
      );
      expect(resolveAntigravityRole(input)).toBe(expectedRole);
    },
  );

  it("unknown subagentRole throws AntigravityInputParseError", () => {
    const input = parseAntigravityInput(
      JSON.stringify({
        tool_name: "write_to_file",
        agentType: "specialist",
      }),
    );
    expect(() => resolveAntigravityRole(input)).toThrow(AntigravityInputParseError);
  });
});

describe("Antigravity Adapter: Tool Mapping", () => {
  it.each([
    { toolName: "mcp_ramune_read_graph", expectedAction: "READ_GRAPH" },
    { toolName: "mcp_ramune_claim_ready", expectedAction: "CLAIM_READY" },
    { toolName: "mcp_ramune_claim_integration", expectedAction: "CLAIM_INTEGRATION" },
    { toolName: "mcp_ramune_abandon_assignment", expectedAction: "ABANDON_ASSIGNMENT" },
    { toolName: "mcp_ramune_resume", expectedAction: "RESUME" },
    { toolName: "mcp_ramune_start", expectedAction: "START_SESSION" },
    { toolName: "mcp_ramune_end", expectedAction: "END_SESSION" },
    { toolName: "mcp_ramune_apply_ops", expectedAction: "APPLY_OPS" },
    { toolName: "mcp_ramune_record_result", expectedAction: "RECORD_RESULT" },
    { toolName: "mcp_ramune_submit_candidate", expectedAction: "SUBMIT_CANDIDATE" },
    { toolName: "mcp_ramune_request_replan", expectedAction: "REQUEST_REPLAN" },
    { toolName: "mcp_ramune_advance_integration", expectedAction: "ADVANCE_INTEGRATION" },
    {
      toolName: "mcp_ramune_record_integration_outcome",
      expectedAction: "RECORD_INTEGRATION_OUTCOME",
    },
    { toolName: "write_to_file", expectedAction: "FILE_MUTATION" },
    { toolName: "replace_file_content", expectedAction: "FILE_MUTATION" },
  ] as const)("toolName=$toolName maps to $expectedAction", ({ toolName, expectedAction }) => {
    expect(mapAntigravityToolToAction(toolName)).toBe(expectedAction);
  });

  it("unknown tool throws UnknownActionError", () => {
    expect(() => mapAntigravityToolToAction("unknown_tool")).toThrow(UnknownActionError);
  });
});

describe("Antigravity Adapter: Formatter", () => {
  it("formatAntigravityAllow returns { decision: 'allow' }", () => {
    expect(formatAntigravityAllow()).toBe(JSON.stringify({ decision: "allow" }));
  });

  it("formatAntigravityDeny returns { decision: 'deny', reason: ... }", () => {
    const denyJson = formatAntigravityDeny("Access denied");
    expect(JSON.parse(denyJson)).toStrictEqual({
      decision: "deny",
      reason: "Access denied",
    });
  });

  it("formatAntigravityDecision formats correctly", () => {
    expect(formatAntigravityDecision({ decision: "allow" })).toBe(
      JSON.stringify({ decision: "allow" }),
    );
    expect(formatAntigravityDecision({ decision: "deny", reason: "Blocked" })).toBe(
      JSON.stringify({ decision: "deny", reason: "Blocked" }),
    );
  });
});

describe("Antigravity Adapter: Runner Pipeline", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-ag-test-"));
    repoRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("active session enforces role permissions", () => {
    writeGraphFile(repoRoot, ACTIVE_GRAPH);

    const orchWrite = runAntigravityHook(JSON.stringify({ tool_name: "write_to_file" }), repoRoot);
    expect(orchWrite).toContain("worker");
    expect(orchWrite).toContain("deny");

    const workerWrite = runAntigravityHook(
      JSON.stringify({ tool_name: "write_to_file", agentType: "worker" }),
      repoRoot,
    );
    expect(JSON.parse(workerWrite)).toStrictEqual({ decision: "allow" });
  });

  it("inactive session allows all tools", () => {
    writeGraphFile(repoRoot, INACTIVE_GRAPH);

    const orchWrite = runAntigravityHook(JSON.stringify({ tool_name: "write_to_file" }), repoRoot);
    expect(JSON.parse(orchWrite)).toStrictEqual({ decision: "allow" });
  });

  it("malformed payload fails closed with deny output", () => {
    writeGraphFile(repoRoot, ACTIVE_GRAPH);

    const result = runAntigravityHook("{broken json", repoRoot);
    expect(result).toContain("deny");
  });
});
