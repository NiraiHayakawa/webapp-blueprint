import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalRepo, v2GraphJson, writeGraphFile } from "../support/fake-repo.ts";
import { buildClaudeInput, resolveAdapterEntrypoint, runHookSubprocess } from "./support/runner.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-e2e-t2-json", epoch: 0 });
const hasClaude = fs.existsSync(resolveAdapterEntrypoint("claude"));

describe("Tier 2: Empty & Corrupted JSON Stdin", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t2-empty-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T2-1: Empty string stdin fails closed with deny response", () => {
    const res = runHookSubprocess("claude", "", repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("deny");
  });

  it.runIf(hasClaude)("T2-2: Corrupted JSON syntax fails closed with deny response", () => {
    const res = runHookSubprocess("claude", '{ "tool_name": "Edit"', repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("deny");
  });
});

describe("Tier 2: Primitive & Array JSON Stdin", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t2-prim-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T2-3: JSON primitives fail closed with deny response", () => {
    const numberRes = runHookSubprocess("claude", "12345", repoRoot);
    expect(numberRes.decision).toBe("deny");

    const stringRes = runHookSubprocess("claude", '"just a string"', repoRoot);
    expect(stringRes.decision).toBe("deny");
  });

  it.runIf(hasClaude)("T2-4: Array JSON root fails closed with deny response", () => {
    const res = runHookSubprocess(
      "claude",
      JSON.stringify([{ hook_event_name: "PreToolUse", tool_name: "Edit" }]),
      repoRoot,
    );
    expect(res.decision).toBe("deny");
  });
});

describe("Tier 2: Missing & Invalid Schema Fields", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t2-fld-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T2-5: Missing or empty tool_name fails closed with deny", () => {
    const missingRes = runHookSubprocess(
      "claude",
      JSON.stringify({ hook_event_name: "PreToolUse" }),
      repoRoot,
    );
    expect(missingRes.decision).toBe("deny");

    const emptyRes = runHookSubprocess(
      "claude",
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "" }),
      repoRoot,
    );
    expect(emptyRes.decision).toBe("deny");
  });

  it.runIf(hasClaude)("T2-6: Non-string tool_name fails closed with deny", () => {
    const res = runHookSubprocess(
      "claude",
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: 999 }),
      repoRoot,
    );
    expect(res.decision).toBe("deny");
  });
});

describe("Tier 2: Unknown Agent & Tool Names", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t2-unkn-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T2-7: Unknown agent_type fails fast with deny", () => {
    const res = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit", agentType: "unauthorized-subagent" }),
      repoRoot,
    );
    expect(res.decision).toBe("deny");
    expect(res.reason).toMatch(/unauthorized-subagent/u);
  });

  it.runIf(hasClaude)("T2-8: Unknown tool fails fast with deny", () => {
    const res = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__destroy_system" }),
      repoRoot,
    );
    expect(res.decision).toBe("deny");
    expect(res.reason).toMatch(/destroy_system/u);
  });
});
