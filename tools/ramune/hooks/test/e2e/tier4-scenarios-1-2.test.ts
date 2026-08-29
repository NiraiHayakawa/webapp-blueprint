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

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-e2e-t4-12", epoch: 0 });
const hasClaude = fs.existsSync(resolveAdapterEntrypoint("claude"));

describe("Tier 4: Scenario 1a - Feature Setup & Implementation", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t4-p1a-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T4-1a: Setup, planning, claim, and worker implementation", () => {
    const startRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_start" }),
      repoRoot,
    );
    expect(startRes.decision).toBe("allow");

    const plannerRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_apply_ops", agentType: "planner" }),
      repoRoot,
    );
    expect(plannerRes.decision).toBe("allow");

    const workerWorktree = createLinkedWorktree(repoRoot, "worker-task-1");
    const workerEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit", agentType: "worker" }),
      workerWorktree,
    );
    expect(workerEdit.decision).toBe("allow");

    const workerSubmit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_submit_candidate", agentType: "worker" }),
      workerWorktree,
    );
    expect(workerSubmit.decision).toBe("allow");
  });
});

describe("Tier 4: Scenario 1b - Integration Verification", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t4-p1b-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T4-1b: Integration claim and advance allowed", () => {
    const claimIntRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_claim_integration" }),
      repoRoot,
    );
    expect(claimIntRes.decision).toBe("allow");

    const intWorktree = createLinkedWorktree(repoRoot, "integration-wt");
    const intAdvance = runHookSubprocess(
      "claude",
      buildClaudeInput({
        toolName: "mcp__ramune__ramune_advance_integration",
        agentType: "integrator",
      }),
      intWorktree,
    );
    expect(intAdvance.decision).toBe("allow");
  });
});

describe("Tier 4: Scenario 1c - Integration Outcome & Session Close", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t4-p1c-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T4-1c: Record integration outcome and end session", () => {
    const intWorktree = createLinkedWorktree(repoRoot, "integration-wt-2");
    const intOutcome = runHookSubprocess(
      "claude",
      buildClaudeInput({
        toolName: "mcp__ramune__ramune_record_integration_outcome",
        agentType: "integrator",
      }),
      intWorktree,
    );
    expect(intOutcome.decision).toBe("allow");

    const endRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_end" }),
      repoRoot,
    );
    expect(endRes.decision).toBe("allow");
  });
});

describe("Tier 4: Scenario 2 - Worker Blocker & Replan Workflow", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t4-replan-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T4-2: Worker Obstacle Escalation & Replan Workflow", () => {
    const workerWorktree = createLinkedWorktree(repoRoot, "worker-task-blocked");

    const replanRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_request_replan", agentType: "worker" }),
      workerWorktree,
    );
    expect(replanRes.decision).toBe("allow");

    const planRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_apply_ops", agentType: "planner" }),
      repoRoot,
    );
    expect(planRes.decision).toBe("allow");

    const resumeEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit", agentType: "worker" }),
      workerWorktree,
    );
    expect(resumeEdit.decision).toBe("allow");
  });
});
