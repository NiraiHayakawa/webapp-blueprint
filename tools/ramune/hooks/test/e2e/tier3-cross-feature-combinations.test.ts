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
import {
  buildAntigravityInput,
  buildClaudeInput,
  buildCodexInput,
  resolveAdapterEntrypoint,
  runHookSubprocess,
} from "./support/runner.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-e2e-t3", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });

const hasClaude = fs.existsSync(resolveAdapterEntrypoint("claude"));
const hasAg = fs.existsSync(resolveAdapterEntrypoint("antigravity"));
const hasCodex = fs.existsSync(resolveAdapterEntrypoint("codex"));
const allAdaptersExist = hasClaude && hasAg && hasCodex;

describe("Tier 3: Session Inactive to Active Transition", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t3-s1-"));
    repoRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T3-1a: Inactive to active updates policy dynamically", () => {
    writeGraphFile(repoRoot, INACTIVE_GRAPH);
    const inactiveEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit" }),
      repoRoot,
    );
    expect(inactiveEdit.decision).toBe("allow");

    writeGraphFile(repoRoot, ACTIVE_GRAPH);
    const activeOrchEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit" }),
      repoRoot,
    );
    expect(activeOrchEdit.decision).toBe("deny");

    const activeWorkerEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit", agentType: "worker" }),
      repoRoot,
    );
    expect(activeWorkerEdit.decision).toBe("allow");
  });
});

describe("Tier 3: Session Active to Inactive Transition", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t3-s2-"));
    repoRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T3-1b: Active back to inactive restores open permissions", () => {
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
    const activeOrchEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit" }),
      repoRoot,
    );
    expect(activeOrchEdit.decision).toBe("deny");

    writeGraphFile(repoRoot, INACTIVE_GRAPH);
    const postInactiveEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit" }),
      repoRoot,
    );
    expect(postInactiveEdit.decision).toBe("allow");
  });
});

describe("Tier 3: Role Handoff Orch to Worker", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t3-h1-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T3-2a: Role handoff from Orchestrator to Planner to Worker", () => {
    const orchClaim = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_claim_ready" }),
      repoRoot,
    );
    expect(orchClaim.decision).toBe("allow");

    const plannerOps = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_apply_ops", agentType: "planner" }),
      repoRoot,
    );
    expect(plannerOps.decision).toBe("allow");

    const workerEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit", agentType: "worker" }),
      repoRoot,
    );
    expect(workerEdit.decision).toBe("allow");
  });
});

describe("Tier 3: Role Handoff Worker to Orch", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t3-h2-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T3-2b: Role handoff from Worker to Integrator to Orchestrator", () => {
    const workerSubmit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_submit_candidate", agentType: "worker" }),
      repoRoot,
    );
    expect(workerSubmit.decision).toBe("allow");

    const integratorAdv = runHookSubprocess(
      "claude",
      buildClaudeInput({
        toolName: "mcp__ramune__ramune_advance_integration",
        agentType: "integrator",
      }),
      repoRoot,
    );
    expect(integratorAdv.decision).toBe("allow");

    const orchEnd = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_end" }),
      repoRoot,
    );
    expect(orchEnd.decision).toBe("allow");
  });
});

describe("Tier 3: Linked Worktree Deep Subdirectory Resolution", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t3-wt-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)(
    "T3-3: Deep subdirectory in linked worktree resolves to canonical graph session",
    () => {
      const worktreeRoot = createLinkedWorktree(repoRoot, "worker-wt-deep");
      const deepSubDir = path.join(worktreeRoot, "packages", "feature", "src", "nested");
      fs.mkdirSync(deepSubDir, { recursive: true });

      const workerRes = runHookSubprocess(
        "claude",
        buildClaudeInput({ toolName: "Edit", agentType: "worker" }),
        deepSubDir,
      );
      expect(workerRes.decision).toBe("allow");

      const orchRes = runHookSubprocess(
        "claude",
        buildClaudeInput({ toolName: "Edit" }),
        deepSubDir,
      );
      expect(orchRes.decision).toBe("deny");
    },
  );
});

describe("Tier 3: Multi-Client Semantic Consistency", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t3-multi-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(allAdaptersExist)("T3-4: Multi-client adapters evaluate identical permissions", () => {
    const claudeRead = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "mcp__ramune__ramune_read_graph" }),
      repoRoot,
    );
    const agRead = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "mcp_ramune_ramune_read_graph" }),
      repoRoot,
    );
    const codexRead = runHookSubprocess(
      "codex",
      buildCodexInput({ toolName: "ramune_read_graph" }),
      repoRoot,
    );

    expect(claudeRead.decision).toBe("allow");
    expect(agRead.decision).toBe("allow");
    expect(codexRead.decision).toBe("allow");

    const claudeEdit = runHookSubprocess(
      "claude",
      buildClaudeInput({ toolName: "Edit" }),
      repoRoot,
    );
    expect(claudeEdit.decision).toBe("deny");
  });
});
