import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalRepo, v2GraphJson, writeGraphFile } from "../support/fake-repo.ts";
import { buildClaudeInput, resolveAdapterEntrypoint, runHookSubprocess } from "./support/runner.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-e2e-t1-claude", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });
const hasClaude = fs.existsSync(resolveAdapterEntrypoint("claude"));

describe("Tier 1 Claude: Orchestrator Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-c-orch-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("F5-1a: Orchestrator graph reading and start session allowed", () => {
    const readRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_read_graph" }),
      repoRoot,
    );
    expect(readRes.decision).toBe("allow");

    const startRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_start" }),
      repoRoot,
    );
    expect(startRes.decision).toBe("allow");
  });

  it.runIf(hasClaude)("F5-1b: Orchestrator claim ready is allowed", () => {
    const claimRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_claim_ready" }),
      repoRoot,
    );
    expect(claimRes.decision).toBe("allow");
  });

  it.runIf(hasClaude)("F5-1c: Orchestrator file mutation is denied", () => {
    const editRes = runHookSubprocess("claude", buildClaudeInput({ toolName: "Edit" }), repoRoot);
    expect(editRes.decision).toBe("deny");
    expect(editRes.reason).toMatch(/worker/iu);
  });
});

describe("Tier 1 Claude: Inactive Session", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-c-inact-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, INACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)(
    "F5-6: Inactive session allows all tools with empty output and exit code 0",
    () => {
      const editRes = runHookSubprocess("claude", buildClaudeInput({ toolName: "Edit" }), repoRoot);
      expect(editRes.decision).toBe("allow");
      expect(editRes.stdout).toBe("");
    },
  );
});

describe("Tier 1 Claude: Planner Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-c-plan-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("F5-2a: Planner apply_ops allowed", () => {
    const opsRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_apply_ops", agentType: "planner" }),
      repoRoot,
    );
    expect(opsRes.decision).toBe("allow");
  });

  it.runIf(hasClaude)("F5-2b: Planner Edit & record_result denied", () => {
    const editRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit", agentType: "planner" }),
      repoRoot,
    );
    expect(editRes.decision).toBe("deny");

    const recordRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_record_result", agentType: "planner" }),
      repoRoot,
    );
    expect(recordRes.decision).toBe("deny");
  });
});

describe("Tier 1 Claude: Worker Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-c-work-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("F5-3a: Worker file mutation tools (Edit, Write) are allowed", () => {
    const editRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit", agentType: "worker", agentId: "w1" }),
      repoRoot,
    );
    expect(editRes.decision).toBe("allow");

    const writeRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Write", agentType: "worker", agentId: "w1" }),
      repoRoot,
    );
    expect(writeRes.decision).toBe("allow");
  });

  it.runIf(hasClaude)("F5-3b: Worker candidate submission allowed; apply_ops denied", () => {
    const submitRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_submit_candidate", agentType: "worker" }),
      repoRoot,
    );
    expect(submitRes.decision).toBe("allow");

    const opsRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_apply_ops", agentType: "worker" }),
      repoRoot,
    );
    expect(opsRes.decision).toBe("deny");
  });
});

describe("Tier 1 Claude: Integrator & Replan Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-c-int-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("F5-4: Integrator advance & outcome allowed; Edit denied", () => {
    const advRes = runHookSubprocess(
      "claude",
      buildClaudeInput({
        toolName: "mcp__ramune__ramune_advance_integration",
        agentType: "integrator",
      }),
      repoRoot,
    );
    expect(advRes.decision).toBe("allow");

    const editRes = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit", agentType: "integrator" }),
      repoRoot,
    );
    expect(editRes.decision).toBe("deny");
  });

  it.runIf(hasClaude)("F5-5: Replan allowed for Worker; denied for Orchestrator", () => {
    const workerReplan = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_request_replan", agentType: "worker" }),
      repoRoot,
    );
    expect(workerReplan.decision).toBe("allow");

    const orchReplan = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_request_replan" }),
      repoRoot,
    );
    expect(orchReplan.decision).toBe("deny");
  });
});
