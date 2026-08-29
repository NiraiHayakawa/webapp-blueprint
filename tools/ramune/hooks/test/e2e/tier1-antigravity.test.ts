import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalRepo, v2GraphJson, writeGraphFile } from "../support/fake-repo.ts";
import {
  buildAntigravityInput,
  resolveAdapterEntrypoint,
  runHookSubprocess,
} from "./support/runner.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-e2e-t1-ag", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });
const hasAg = fs.existsSync(resolveAdapterEntrypoint("antigravity"));

describe("Tier 1 Antigravity: Orchestrator Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-ag-orch-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasAg)("F6-1a: Top-level Orchestrator claim and read are allowed", () => {
    const readRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "mcp_ramune_ramune_read_graph" }),
      repoRoot,
    );
    expect(readRes.exitCode).toBe(0);
    expect(readRes.decision).toBe("allow");

    const claimRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "mcp_ramune_ramune_claim_ready" }),
      repoRoot,
    );
    expect(claimRes.exitCode).toBe(0);
    expect(claimRes.decision).toBe("allow");
  });

  it.runIf(hasAg)("F6-1b: Orchestrator file mutation is denied", () => {
    const mutateRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "replace_file_content" }),
      repoRoot,
    );
    expect(mutateRes.exitCode).toBe(0);
    expect(mutateRes.decision).toBe("deny");
  });
});

describe("Tier 1 Antigravity: Inactive Session", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-ag-inact-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, INACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasAg)("F6-6: Inactive session allows tools with allow decision or empty output", () => {
    const replaceRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "replace_file_content" }),
      repoRoot,
    );
    expect(replaceRes.exitCode).toBe(0);
    expect(replaceRes.decision).toBe("allow");
  });
});

describe("Tier 1 Antigravity: Planner Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-ag-pl-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasAg)("F6-2: Planner apply_ops allowed; write_to_file denied", () => {
    const opsRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "mcp_ramune_ramune_apply_ops", subagentRole: "planner" }),
      repoRoot,
    );
    expect(opsRes.exitCode).toBe(0);
    expect(opsRes.decision).toBe("allow");

    const writeRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "write_to_file", subagentRole: "planner" }),
      repoRoot,
    );
    expect(writeRes.exitCode).toBe(0);
    expect(writeRes.decision).toBe("deny");
  });
});

describe("Tier 1 Antigravity: Worker Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-ag-wo-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasAg)("F6-3: Worker file mutation allowed; apply_ops denied", () => {
    const writeRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "write_to_file", subagentRole: "worker" }),
      repoRoot,
    );
    expect(writeRes.exitCode).toBe(0);
    expect(writeRes.decision).toBe("allow");

    const opsRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "mcp_ramune_ramune_apply_ops", subagentRole: "worker" }),
      repoRoot,
    );
    expect(opsRes.exitCode).toBe(0);
    expect(opsRes.decision).toBe("deny");
  });
});

describe("Tier 1 Antigravity: Integrator Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-ag-intg-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasAg)("F6-4: Integrator advance allowed; replace_file_content denied", () => {
    const advRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({
        toolName: "mcp_ramune_ramune_advance_integration",
        subagentRole: "integrator",
      }),
      repoRoot,
    );
    expect(advRes.exitCode).toBe(0);
    expect(advRes.decision).toBe("allow");

    const replaceRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "replace_file_content", subagentRole: "integrator" }),
      repoRoot,
    );
    expect(replaceRes.exitCode).toBe(0);
    expect(replaceRes.decision).toBe("deny");
  });
});

describe("Tier 1 Antigravity: Replan Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-ag-rep-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasAg)("F6-5: Replan allowed for Worker; denied for Orchestrator", () => {
    const workerRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({
        toolName: "mcp_ramune_ramune_request_replan",
        subagentRole: "worker",
      }),
      repoRoot,
    );
    expect(workerRes.exitCode).toBe(0);
    expect(workerRes.decision).toBe("allow");

    const orchRes = runHookSubprocess(
      "antigravity",
      buildAntigravityInput({ toolName: "mcp_ramune_ramune_request_replan" }),
      repoRoot,
    );
    expect(orchRes.exitCode).toBe(0);
    expect(orchRes.decision).toBe("deny");
  });
});
