import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalRepo, v2GraphJson, writeGraphFile } from "../support/fake-repo.ts";
import {
  buildAntigravityInput,
  buildClaudeInput,
  buildCodexInput,
  runHookSubprocess,
  type ClientType,
} from "./support/runner.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-e2e-t5-adv", epoch: 0 });
const CLIENTS: readonly ClientType[] = ["claude", "antigravity", "codex"];
const HUGE_PAYLOAD_SIZE = 100_000;
const CONCURRENT_BATCH_SIZE = 10;

function buildDefaultInputForClient(client: ClientType): string {
  if (client === "claude") {
    return buildClaudeInput();
  }
  if (client === "antigravity") {
    return buildAntigravityInput();
  }
  return buildCodexInput();
}

function buildMassiveInputForClient(client: ClientType): string {
  const noise = "A".repeat(HUGE_PAYLOAD_SIZE);
  if (client === "claude") {
    return buildClaudeInput({ toolName: "Edit", agentType: "worker", extraPayload: { noise } });
  }
  if (client === "antigravity") {
    return buildAntigravityInput({
      toolName: "write_to_file",
      subagentRole: "worker",
      extraPayload: { noise },
    });
  }
  return buildCodexInput({ toolName: "apply_diff", role: "worker", extraPayload: { noise } });
}

function buildUnicodeInputForClient(client: ClientType): string {
  if (client === "claude") {
    return buildClaudeInput({
      toolName: "mcp__ramune__ramune_read_graph",
      agentType: "worker",
      sessionId: "セッション🔥_مرحبا_123",
    });
  }
  if (client === "antigravity") {
    return buildAntigravityInput({
      toolName: "mcp_ramune_ramune_read_graph",
      subagentRole: "worker",
      conversationId: "会話💡_שָׁלוֹם_456",
    });
  }
  return buildCodexInput({ toolName: "ramune_read_graph", role: "worker" });
}

function buildWhitespaceToolInput(client: ClientType): string {
  if (client === "claude") {
    return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit\n" });
  }
  if (client === "antigravity") {
    return JSON.stringify({ toolCall: { name: " write_to_file" } });
  }
  return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "apply_diff\r\n" });
}

describe("Tier 5: Prototype Pollution", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t5-pollution-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.each(CLIENTS)("T5-1: %s rejects prototype pollution payloads safely", (client) => {
    const maliciousPayload = JSON.stringify({
      __proto__: { isAdmin: true, role: "worker", state: "inactive" },
      constructor: { prototype: { role: "worker" } },
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      toolCall: { name: "write_to_file", args: {} },
    });

    const res = runHookSubprocess(client, maliciousPayload, repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("deny");
  });

  it.each(CLIENTS)("T5-2: %s safely processes massive JSON payloads", (client) => {
    const raw = buildMassiveInputForClient(client);
    const res = runHookSubprocess(client, raw, repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("allow");
  });
});

describe("Tier 5: Unicode Characters", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t5-unicode-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.each(CLIENTS)("T5-3: %s safely handles multi-byte unicode and emojis", (client) => {
    const raw = buildUnicodeInputForClient(client);
    const res = runHookSubprocess(client, raw, repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("allow");
  });

  it.each(CLIENTS)("T5-4: %s fails closed when tool name contains whitespace", (client) => {
    const raw = buildWhitespaceToolInput(client);
    const res = runHookSubprocess(client, raw, repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("deny");
  });
});

describe("Tier 5: Corrupted Graph Files", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t5-graph-"));
    repoRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.each(CLIENTS)("T5-5: %s fails closed when graph.json is invalid JSON", (client) => {
    fs.mkdirSync(path.join(repoRoot, ".ramune"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, ".ramune", "graph.json"), "{ invalid json <<<<");

    const raw = buildDefaultInputForClient(client);
    const res = runHookSubprocess(client, raw, repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("deny");
  });

  it.each(CLIENTS)("T5-6: %s fails closed when session.state has invalid value", (client) => {
    fs.mkdirSync(path.join(repoRoot, ".ramune"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, ".ramune", "graph.json"),
      JSON.stringify({ version: 2, session: { state: "unknown-state" } }),
    );

    const raw = buildDefaultInputForClient(client);
    const res = runHookSubprocess(client, raw, repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("deny");
  });

  it.each(CLIENTS)("T5-7: %s fails closed when session is missing from graph", (client) => {
    fs.mkdirSync(path.join(repoRoot, ".ramune"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, ".ramune", "graph.json"),
      JSON.stringify({ version: 2, nodes: {} }),
    );

    const raw = buildDefaultInputForClient(client);
    const res = runHookSubprocess(client, raw, repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("deny");
  });
});

describe("Tier 5: Non-Git Environment", () => {
  let tempNonGitDir: string;

  beforeEach(() => {
    tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t5-nongit-"));
  });

  afterEach(() => {
    fs.rmSync(tempNonGitDir, { recursive: true, force: true });
  });

  it.each(CLIENTS)("T5-8: %s fails closed in non-git directories", (client) => {
    const raw = buildDefaultInputForClient(client);
    const res = runHookSubprocess(client, raw, tempNonGitDir);
    expect(res.exitCode).toBe(0);
    expect(res.decision).toBe("deny");
  });
});

describe("Tier 5: Stress Concurrency", () => {
  let parentDir: string;
  let repoRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-t5-stress-"));
    repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("T5-9: Concurrent burst of mixed client executions succeeds reliably", async () => {
    const tasks = Array.from({ length: CONCURRENT_BATCH_SIZE }, async () => {
      const claude = runHookSubprocess(
        "claude",
        buildClaudeInput({ toolName: "Edit", agentType: "worker" }),
        repoRoot,
      );
      const anti = runHookSubprocess(
        "antigravity",
        buildAntigravityInput({ toolName: "write_to_file" }),
        repoRoot,
      );
      const codex = runHookSubprocess(
        "codex",
        buildCodexInput({ toolName: "ramune_advance_integration", role: "integrator" }),
        repoRoot,
      );
      return [claude.decision, anti.decision, codex.decision];
    });

    const results = await Promise.all(tasks);
    const expected = Array.from({ length: CONCURRENT_BATCH_SIZE }, () => [
      "allow",
      "deny",
      "allow",
    ]);
    expect(results).toStrictEqual(expected);
  });
});
