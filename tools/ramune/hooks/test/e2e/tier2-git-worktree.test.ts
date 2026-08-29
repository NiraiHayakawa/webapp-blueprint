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

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-e2e-t2-gw", epoch: 0 });
const hasClaude = fs.existsSync(resolveAdapterEntrypoint("claude"));

describe("Tier 2: Corrupted Session State in Graph", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t2-cg-"));
    repoRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T2-9: Malformed JSON in graph fails closed with deny", () => {
    writeGraphFile(repoRoot, "{ not valid json");
    const res = runHookSubprocess("claude", buildClaudeInput({ toolName: "Edit" }), repoRoot);
    expect(res.decision).toBe("deny");
    expect(res.reason).toMatch(/ramune/iu);
  });

  it.runIf(hasClaude)("T2-10: Missing session object fails closed with deny", () => {
    writeGraphFile(repoRoot, JSON.stringify({ version: 2, nodes: [] }));
    const res = runHookSubprocess("claude", buildClaudeInput({ toolName: "Edit" }), repoRoot);
    expect(res.decision).toBe("deny");
  });
});

describe("Tier 2: Invalid State & Legacy Graph Format", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t2-inv-"));
    repoRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T2-11: Invalid session.state value fails closed with deny", () => {
    writeGraphFile(repoRoot, JSON.stringify({ version: 2, session: { state: "unknown_state" } }));
    const res = runHookSubprocess("claude", buildClaudeInput({ toolName: "Edit" }), repoRoot);
    expect(res.decision).toBe("deny");
  });

  it.runIf(hasClaude)("T2-12: Legacy v1 graph format is rejected with deny", () => {
    writeGraphFile(repoRoot, JSON.stringify({ version: 1, session: { active: true } }));
    const res = runHookSubprocess("claude", buildClaudeInput({ toolName: "Edit" }), repoRoot);
    expect(res.decision).toBe("deny");
  });
});

describe("Tier 2: Git Repository Boundaries", () => {
  it.runIf(hasClaude)("T2-13: Execution outside git repo fails closed with deny", () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t2-nongit-"));
    try {
      const res = runHookSubprocess(
        "claude",
        buildClaudeInput({ toolName: "mcp__ramune__ramune_read_graph" }),
        plainDir,
      );
      expect(res.decision).toBe("deny");
      expect(res.reason).toMatch(/canonical/u);
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});

describe("Tier 2: Linked Worktree Boundaries", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t2-lwt-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)(
    "T2-14: Corrupted .git file in linked worktree fails closed with deny",
    () => {
      const worktreeRoot = createLinkedWorktree(repoRoot, "corrupted-worktree");
      fs.writeFileSync(path.join(worktreeRoot, ".git"), "corrupted-content-no-gitdir\n", "utf-8");

      const res = runHookSubprocess(
        "claude",
        buildClaudeInput({ toolName: "Edit", agentType: "worker" }),
        worktreeRoot,
      );
      expect(res.decision).toBe("deny");
      expect(res.reason).toMatch(/gitdir/u);
    },
  );

  it.runIf(hasClaude)(
    "T2-15: Worktree pointing to non-existent gitdir fails closed with deny",
    () => {
      const worktreeRoot = path.join(parentDir, "stale-worktree");
      fs.mkdirSync(worktreeRoot, { recursive: true });
      fs.writeFileSync(
        path.join(worktreeRoot, ".git"),
        `gitdir: ${path.join(parentDir, "non-existent-git-dir")}\n`,
        "utf-8",
      );

      const res = runHookSubprocess(
        "claude",
        buildClaudeInput({ toolName: "Edit", agentType: "worker" }),
        worktreeRoot,
      );
      expect(res.decision).toBe("deny");
    },
  );
});

describe("Tier 2: Special Characters & Extra Fields", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t2-spc-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.runIf(hasClaude)("T2-16: Unicode & emojis in payload are processed cleanly", () => {
    const res = runHookSubprocess(
      "claude",
      buildClaudeInput({
        toolName: "Edit",
        agentType: "worker",
        sessionId: "セッション-🚀-123",
        extraPayload: { note: "日本語のコメント 🎯" },
      }),
      repoRoot,
    );
    expect(res.decision).toBe("allow");
  });

  it.runIf(hasClaude)("T2-17: Unexpected extra fields are tolerated without failure", () => {
    const res = runHookSubprocess(
      "claude",
      buildClaudeInput({
        toolName: "mcp__ramune__ramune_read_graph",
        extraPayload: { future_field_v3: { count: 42 } },
      }),
      repoRoot,
    );
    expect(res.decision).toBe("allow");
  });
});
