import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCanonicalRepo,
  createLinkedWorktree,
  v2GraphJson,
  writeGraphFile,
} from "../support/fake-repo.ts";
import { buildClaudeInput, resolveAdapterEntrypoint, runHookSubprocess } from "./support/runner.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-e2e-t4-34", epoch: 0 });
const hasClaude = fs.existsSync(resolveAdapterEntrypoint("claude"));

describe("Tier 4: Scenario 3a - Merge Conflict Detection & Fix", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t4-c3a-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T4-3a: Conflict detected and worker resolves with edit", () => {
    const intWorktree = createLinkedWorktree(repoRoot, "integration-conflict");
    const workerWorktree = createLinkedWorktree(repoRoot, "worker-resolve-conflict");

    const conflictRes = runHookSubprocess(
      "claude",
      buildClaudeInput({
        toolName: "mcp__ramune__ramune_record_integration_outcome",
        agentType: "integrator",
      }),
      intWorktree,
    );
    expect(conflictRes.decision).toBe("allow");

    const resolveEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit", agentType: "worker" }),
      workerWorktree,
    );
    expect(resolveEdit.decision).toBe("allow");
  });
});

describe("Tier 4: Scenario 3b - Candidate Submission & Finalize", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t4-c3b-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T4-3b: Worker resubmits candidate and integrator finalizes", () => {
    const intWorktree = createLinkedWorktree(repoRoot, "integration-conflict-2");
    const workerWorktree = createLinkedWorktree(repoRoot, "worker-resolve-conflict-2");

    const submitRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_submit_candidate", agentType: "worker" }),
      workerWorktree,
    );
    expect(submitRes.decision).toBe("allow");

    const finalizeRes = runHookSubprocess(
      "claude",
      buildClaudeInput({
        toolName: "mcp__ramune__ramune_advance_integration",
        agentType: "integrator",
      }),
      intWorktree,
    );
    expect(finalizeRes.decision).toBe("allow");
  });
});

describe("Tier 4: Scenario 4a - Orchestrator & Worker Gating", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t4-s4a-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T4-4a: Orchestrator and Worker unauthorized actions blocked", () => {
    const orchEdit = runHookSubprocess("claude", buildClaudeInput({ toolName: "Edit" }), repoRoot);
    expect(orchEdit.decision).toBe("deny");

    const workerOps = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_apply_ops", agentType: "worker" }),
      repoRoot,
    );
    expect(workerOps.decision).toBe("deny");
  });
});

describe("Tier 4: Scenario 4b - Planner & Integrator Gating", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t4-s4b-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T4-4b: Planner and Integrator unauthorized actions blocked", () => {
    const plannerRecord = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_record_result", agentType: "planner" }),
      repoRoot,
    );
    expect(plannerRecord.decision).toBe("deny");

    const intWrite = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Write", agentType: "integrator" }),
      repoRoot,
    );
    expect(intWrite.decision).toBe("deny");
  });
});
