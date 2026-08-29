import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseAntigravityResponse, parseClaudeResponse, parseCodexResponse } from "./schemas.ts";
import type { ClaudeInput } from "../../../src/adapters/claude/schema.ts";

const HOOKS_SRC_DIR = path.resolve(import.meta.dirname, "../../../src");

export type ClientType = "claude" | "antigravity" | "codex";

export interface ExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly decision: "allow" | "deny";
  readonly reason?: string | undefined;
}

function candidateEntrypoints(client: ClientType): readonly string[] {
  switch (client) {
    case "claude": {
      return [
        path.join(HOOKS_SRC_DIR, "adapters/claude/main.ts"),
        path.join(HOOKS_SRC_DIR, "adapters/claude/cli.ts"),
        path.join(HOOKS_SRC_DIR, "adapters/claude/index.ts"),
        path.join(HOOKS_SRC_DIR, "pre-tool-use.ts"),
      ];
    }
    case "antigravity": {
      return [
        path.join(HOOKS_SRC_DIR, "adapters/antigravity/main.ts"),
        path.join(HOOKS_SRC_DIR, "adapters/antigravity/cli.ts"),
        path.join(HOOKS_SRC_DIR, "adapters/antigravity/index.ts"),
      ];
    }
    case "codex": {
      return [
        path.join(HOOKS_SRC_DIR, "adapters/codex/main.ts"),
        path.join(HOOKS_SRC_DIR, "adapters/codex/cli.ts"),
        path.join(HOOKS_SRC_DIR, "adapters/codex/index.ts"),
      ];
    }
    default: {
      return [];
    }
  }
}

export function resolveAdapterEntrypoint(client: ClientType): string {
  const candidates = candidateEntrypoints(client);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found !== undefined) {
    return found;
  }
  return path.join(HOOKS_SRC_DIR, `adapters/${client}/main.ts`);
}

function parseOutput(
  client: ClientType,
  stdout: string,
): { decision: "allow" | "deny"; reason?: string } {
  switch (client) {
    case "claude": {
      return parseClaudeResponse(stdout);
    }
    case "antigravity": {
      return parseAntigravityResponse(stdout);
    }
    case "codex": {
      return parseCodexResponse(stdout);
    }
    default: {
      throw new Error(`Unsupported client type: ${String(client)}`);
    }
  }
}

export function runHookSubprocess(
  client: ClientType,
  rawStdin: string,
  cwd: string,
): ExecutionResult {
  const entrypoint = resolveAdapterEntrypoint(client);

  const result = childProcess.spawnSync(process.execPath, [entrypoint], {
    input: rawStdin,
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.status;
  const parsed = parseOutput(client, stdout);

  return {
    stdout,
    stderr,
    exitCode,
    decision: parsed.decision,
    reason: parsed.reason,
  };
}

export type ClaudeInputOptions = Partial<ClaudeInput> & {
  readonly extraPayload?: object | undefined;
};

interface ClaudePayload {
  hook_event_name: string;
  tool_name: string;
  session_id: string;
  permission_mode: string;
  agent_type?: string | undefined;
  agent_id?: string | undefined;
}

export function buildClaudeInput(options: ClaudeInputOptions = {}): string {
  const payload: ClaudePayload = {
    hook_event_name: options.hookEventName ?? "PreToolUse",
    tool_name: options.toolName ?? "Edit",
    session_id: options.sessionId ?? "test-session-123",
    permission_mode: "auto",
    agent_type: options.agentType,
    agent_id: options.agentId,
    ...options.extraPayload,
  };

  return JSON.stringify(payload);
}

export interface AntigravityInputOptions {
  readonly toolName?: string | undefined;
  readonly toolArgs?: object | undefined;
  readonly subagentRole?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly extraPayload?: object | undefined;
}

interface AntigravityPayload {
  conversationId: string;
  workspacePaths: readonly string[];
  toolCall: {
    name: string;
    args: object;
  };
  stepIdx: number;
  subagent?:
    | {
        name: string;
        role: string;
      }
    | undefined;
  agentType?: string | undefined;
}

export function buildAntigravityInput(options: AntigravityInputOptions = {}): string {
  const subagent =
    options.subagentRole === undefined
      ? undefined
      : { name: options.subagentRole, role: options.subagentRole };

  const payload: AntigravityPayload = {
    conversationId: options.conversationId ?? "conv-ag-456",
    workspacePaths: [process.cwd()],
    toolCall: {
      name: options.toolName ?? "write_to_file",
      args: options.toolArgs ?? {},
    },
    stepIdx: 1,
    subagent,
    agentType: options.subagentRole,
    ...options.extraPayload,
  };

  return JSON.stringify(payload);
}

export interface CodexInputOptions {
  readonly toolName?: string | undefined;
  readonly toolArgs?: object | undefined;
  readonly role?: string | undefined;
  readonly hookEventName?: string | undefined;
  readonly extraPayload?: object | undefined;
}

interface CodexPayload {
  hook_event_name: string;
  tool_name: string;
  tool: {
    name: string;
    args: object;
  };
  role?: string | undefined;
  agent_type?: string | undefined;
}

export function buildCodexInput(options: CodexInputOptions = {}): string {
  const toolName = options.toolName ?? "apply_diff";
  const payload: CodexPayload = {
    hook_event_name: options.hookEventName ?? "PreToolUse",
    tool_name: toolName,
    tool: {
      name: toolName,
      args: options.toolArgs ?? {},
    },
    role: options.role,
    agent_type: options.role,
    ...options.extraPayload,
  };

  return JSON.stringify(payload);
}
