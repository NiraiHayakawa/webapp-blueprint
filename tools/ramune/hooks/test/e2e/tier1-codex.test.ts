import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalRepo, v2GraphJson, writeGraphFile } from "../support/fake-repo.ts";
import { buildCodexInput, resolveAdapterEntrypoint, runHookSubprocess } from "./support/runner.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-e2e-t1-codex", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });
const hasCodex = fs.existsSync(resolveAdapterEntrypoint("codex"));

describe("Tier 1 Codex: Orchestrator Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-codex-orch-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasCodex)("F7-1a: Orchestrator session control and read are allowed", () => {
    const readRes = runHookSubprocess(
      "codex",
      buildCodexInput({ toolName: "ramune_read_graph" }),
      repoRoot,
    );
    expect(readRes.exitCode).toBe(0);
    expect(readRes.decision).toBe("allow");

    const claimRes = runHookSubprocess(
      "codex",
      buildCodexInput({ toolName: "ramune_claim_ready" }),
      repoRoot,
    );
    expect(claimRes.exitCode).toBe(0);
    expect(claimRes.decision).toBe("allow");
  });

  it.runIf(hasCodex)("F7-1b: Orchestrator apply_diff is denied", () => {
    const diffRes = runHookSubprocess(
      "codex",
      buildCodexInput({ toolName: "apply_diff" }),
      repoRoot,
    );
    expect(diffRes.exitCode).toBe(0);
    expect(diffRes.decision).toBe("deny");
  });
});

describe("Tier 1 Codex: Inactive Session", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-codex-inact-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, INACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasCodex)(
    "F7-5: Inactive session allows tools with allow decision or empty output",
    () => {
      const diffRes = runHookSubprocess(
        "codex",
        buildCodexInput({ toolName: "apply_diff" }),
        repoRoot,
      );
      expect(diffRes.exitCode).toBe(0);
      expect(diffRes.decision).toBe("allow");
    },
  );
});

describe("Tier 1 Codex: Planner Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-codex-pl-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasCodex)("F7-2: Planner apply_ops allowed; write_file denied", () => {
    const opsRes = runHookSubprocess(
      "codex",
      buildCodexInput({ toolName: "ramune_apply_ops", role: "planner" }),
      repoRoot,
    );
    expect(opsRes.exitCode).toBe(0);
    expect(opsRes.decision).toBe("allow");

    const writeRes = runHookSubprocess(
      "codex",
      buildCodexInput({ toolName: "write_file", role: "planner" }),
      repoRoot,
    );
    expect(writeRes.exitCode).toBe(0);
    expect(writeRes.decision).toBe("deny");
  });
});

describe("Tier 1 Codex: Worker Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-codex-wo-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasCodex)("F7-3a: Worker apply_diff and write_file allowed", () => {
    const diffRes = runHookSubprocess(
      "codex",
      buildCodexInput({ toolName: "apply_diff", role: "worker" }),
      repoRoot,
    );
    expect(diffRes.exitCode).toBe(0);
    expect(diffRes.decision).toBe("allow");

    const writeRes = runHookSubprocess(
      "codex",
      buildCodexInput({ toolName: "write_file", role: "worker" }),
      repoRoot,
    );
    expect(writeRes.exitCode).toBe(0);
    expect(writeRes.decision).toBe("allow");
  });

  it.runIf(hasCodex)("F7-3b: Worker apply_ops is denied", () => {
    const opsRes = runHookSubprocess(
      "codex",
      buildCodexInput({ toolName: "ramune_apply_ops", role: "worker" }),
      repoRoot,
    );
    expect(opsRes.exitCode).toBe(0);
    expect(opsRes.decision).toBe("deny");
  });
});

describe("Tier 1 Codex: Integrator Operations", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t1-codex-int-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasCodex)(
    "F7-4: Integrator record_integration_outcome allowed; apply_diff denied",
    () => {
      const outRes = runHookSubprocess(
        "codex",
        buildCodexInput({ toolName: "ramune_record_integration_outcome", role: "integrator" }),
        repoRoot,
      );
      expect(outRes.exitCode).toBe(0);
      expect(outRes.decision).toBe("allow");

      const diffRes = runHookSubprocess(
        "codex",
        buildCodexInput({ toolName: "apply_diff", role: "integrator" }),
        repoRoot,
      );
      expect(diffRes.exitCode).toBe(0);
      expect(diffRes.decision).toBe("deny");
    },
  );
});
