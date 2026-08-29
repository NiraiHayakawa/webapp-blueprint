import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CodexInputParseError,
  formatCodexAllow,
  formatCodexDecision,
  formatCodexDeny,
  mapCodexToolToAction,
  parseCodexInput,
  resolveCodexRole,
  runCodexHook,
} from "../../src/adapters/codex/index.ts";
import { UnknownActionError } from "../../src/core/policy.ts";
import { createCanonicalRepo, v2GraphJson, writeGraphFile } from "../support/fake-repo.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-codex-test", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });

describe("Codex Adapter: Schema Parsing", () => {
  it("valid tool_name payload parses correctly", () => {
    const raw = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "ramune_apply_ops",
      role: "planner",
    });

    const parsed = parseCodexInput(raw);
    expect(parsed.toolName).toBe("ramune_apply_ops");
    expect(parsed.role).toBe("planner");
    expect(parsed.hookEventName).toBe("PreToolUse");
  });

  it("valid nested tool object payload parses correctly", () => {
    const raw = JSON.stringify({
      tool: {
        name: "apply_diff",
        args: { diff: "..." },
      },
      agent_type: "worker",
    });

    const parsed = parseCodexInput(raw);
    expect(parsed.toolName).toBe("apply_diff");
    expect(parsed.role).toBe("worker");
    expect(parsed.toolArgs).toStrictEqual({ diff: "..." });
  });

  it.each([
    { name: "invalid JSON", input: "{corrupt json" },
    { name: "array root", input: JSON.stringify(["item-1", "item-2"]) },
    { name: "primitive number", input: "123" },
    { name: "missing tool_name and tool", input: JSON.stringify({ role: "worker" }) },
    { name: "empty tool.name", input: JSON.stringify({ tool: { name: "" } }) },
    {
      name: "non-string role",
      input: JSON.stringify({ tool_name: "apply_diff", role: 123 }),
    },
  ])("malformed input ($name) throws CodexInputParseError", ({ input }) => {
    expect(() => parseCodexInput(input)).toThrow(CodexInputParseError);
  });
});

describe("Codex Adapter: Role Resolution", () => {
  it.each([
    { role: undefined, expectedRole: "orchestrator" },
    { role: "orchestrator", expectedRole: "orchestrator" },
    { role: "main", expectedRole: "orchestrator" },
    { role: "planner", expectedRole: "planner" },
    { role: "worker", expectedRole: "worker" },
    { role: "integrator", expectedRole: "integrator" },
  ] as const)("role=$role resolves to $expectedRole", ({ role, expectedRole }) => {
    const input = parseCodexInput(
      JSON.stringify({
        tool_name: "apply_diff",
        role,
      }),
    );
    expect(resolveCodexRole(input)).toBe(expectedRole);
  });

  it("unknown role throws CodexInputParseError", () => {
    const input = parseCodexInput(
      JSON.stringify({
        tool_name: "apply_diff",
        role: "rogue-agent",
      }),
    );
    expect(() => resolveCodexRole(input)).toThrow(CodexInputParseError);
  });
});

describe("Codex Adapter: Tool Mapping", () => {
  it.each([
    { toolName: "ramune_read_graph", expectedAction: "READ_GRAPH" },
    { toolName: "mcp__ramune__ramune_read_graph", expectedAction: "READ_GRAPH" },
    { toolName: "ramune_claim_ready", expectedAction: "CLAIM_READY" },
    { toolName: "ramune_claim_integration", expectedAction: "CLAIM_INTEGRATION" },
    { toolName: "ramune_abandon_assignment", expectedAction: "ABANDON_ASSIGNMENT" },
    { toolName: "ramune_resume", expectedAction: "RESUME" },
    { toolName: "ramune_start", expectedAction: "START_SESSION" },
    { toolName: "ramune_end", expectedAction: "END_SESSION" },
    { toolName: "ramune_apply_ops", expectedAction: "APPLY_OPS" },
    { toolName: "ramune_record_result", expectedAction: "RECORD_RESULT" },
    { toolName: "ramune_submit_candidate", expectedAction: "SUBMIT_CANDIDATE" },
    { toolName: "ramune_request_replan", expectedAction: "REQUEST_REPLAN" },
    { toolName: "ramune_advance_integration", expectedAction: "ADVANCE_INTEGRATION" },
    { toolName: "ramune_record_integration_outcome", expectedAction: "RECORD_INTEGRATION_OUTCOME" },
    { toolName: "apply_diff", expectedAction: "FILE_MUTATION" },
    { toolName: "write_file", expectedAction: "FILE_MUTATION" },
  ] as const)("toolName=$toolName maps to $expectedAction", ({ toolName, expectedAction }) => {
    expect(mapCodexToolToAction(toolName)).toBe(expectedAction);
  });

  it("unknown tool throws UnknownActionError", () => {
    expect(() => mapCodexToolToAction("unknown_tool")).toThrow(UnknownActionError);
  });
});

describe("Codex Adapter: Formatter", () => {
  it("formatCodexAllow returns empty stdout for the default permission flow", () => {
    expect(formatCodexAllow()).toBe("");
  });

  it("formatCodexDeny returns Codex PreToolUse hookSpecificOutput", () => {
    const denyJson = formatCodexDeny("Access denied");
    expect(JSON.parse(denyJson)).toStrictEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Access denied",
      },
    });
  });

  it("formatCodexDecision formats correctly", () => {
    expect(formatCodexDecision({ decision: "allow" })).toBe("");
    expect(formatCodexDecision({ decision: "deny", reason: "Blocked" })).toBe(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Blocked",
        },
      }),
    );
  });
});

describe("Codex Adapter: Runner Pipeline", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-codex-test-"));
    repoRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("active session enforces role permissions", () => {
    writeGraphFile(repoRoot, ACTIVE_GRAPH);

    const orchDiff = runCodexHook(JSON.stringify({ tool_name: "apply_diff" }), repoRoot);
    expect(orchDiff).toContain("worker");
    expect(orchDiff).toContain("deny");

    const workerDiff = runCodexHook(
      JSON.stringify({ tool_name: "apply_diff", role: "worker" }),
      repoRoot,
    );
    expect(workerDiff).toBe("");
  });

  it("inactive session allows all tools", () => {
    writeGraphFile(repoRoot, INACTIVE_GRAPH);

    const orchDiff = runCodexHook(JSON.stringify({ tool_name: "apply_diff" }), repoRoot);
    expect(orchDiff).toBe("");
  });

  it("malformed payload fails closed with deny output", () => {
    writeGraphFile(repoRoot, ACTIVE_GRAPH);

    const result = runCodexHook("{broken json", repoRoot);
    expect(result).toContain("deny");
  });
});
