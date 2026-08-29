/**
 * Codex CLI PreToolUse hook 入力スキーマとパーサ。
 * 依存ゼロ制約（ADR 0004）に従い、手書きの型検証を行う。
 */
import type { RawToolInvocationPayload } from "../../core/actions.ts";

export class CodexInputParseError extends Error {
  constructor(reason: string) {
    super(`Codex PreToolUse hook 入力の解析に失敗しました: ${reason}`);
    this.name = "CodexInputParseError";
  }
}

export interface CodexInput {
  readonly toolName: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- CLI ツール引数
  readonly toolArgs?: Record<string, unknown> | undefined;
  readonly role?: string | undefined;
  readonly hookEventName?: string | undefined;
}

interface RawCodexPayload {
  readonly hook_event_name?: unknown;
  readonly tool_name?: unknown;
  readonly tool?: unknown;
  readonly role?: unknown;
  readonly agent_type?: unknown;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- 境界での型ガード
function isRecord(value: unknown): value is Record<string, unknown> {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRawPayload(raw: string): RawCodexPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CodexInputParseError(`stdin が JSON として解析できません（${String(error)}）`);
  }

  if (!isRecord(parsed)) {
    throw new CodexInputParseError("stdin の JSON がオブジェクトではありません");
  }

  return parsed;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- 境界での型検証
function parseToolArgs(tool: unknown): Record<string, unknown> | undefined {
  if (isRecord(tool)) {
    const payload: RawToolInvocationPayload = tool;
    const rawArgs = payload.args;
    if (isRecord(rawArgs)) {
      return rawArgs;
    }
  }
  return undefined;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- 境界での型検証
function extractToolFromObject(tool: unknown): string | undefined {
  if (isRecord(tool)) {
    const payload: RawToolInvocationPayload = tool;
    const rawName = payload.name;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
    if (typeof rawName === "string" && rawName.length > 0) {
      return rawName;
    }
  }
  return undefined;
}

function extractToolInvocation(
  payload: RawCodexPayload,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- CLI ツール引数
): readonly [toolName: string, toolArgs: Record<string, unknown> | undefined] {
  const toolArgs = parseToolArgs(payload.tool);

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  if (typeof payload.tool_name === "string" && payload.tool_name.length > 0) {
    return [payload.tool_name, toolArgs];
  }

  const objName = extractToolFromObject(payload.tool);
  if (objName !== undefined) {
    return [objName, toolArgs];
  }

  throw new CodexInputParseError("tool_name または tool.name が非空文字列として存在しません");
}

function resolveRoleString(payload: RawCodexPayload): string | undefined {
  const { role, agent_type: agentType } = payload;

  if (role !== undefined) {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
    if (typeof role !== "string") {
      throw new CodexInputParseError("role が文字列以外の型で存在します");
    }
    return role;
  }

  if (agentType !== undefined) {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
    if (typeof agentType !== "string") {
      throw new CodexInputParseError("agent_type が文字列以外の型で存在します");
    }
    return agentType;
  }

  return undefined;
}

export function parseCodexInput(raw: string): CodexInput {
  const payload = parseRawPayload(raw);
  const [toolName, toolArgs] = extractToolInvocation(payload);
  const role = resolveRoleString(payload);

  const hookEventName =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
    typeof payload.hook_event_name === "string" ? payload.hook_event_name : undefined;

  return {
    toolName,
    toolArgs,
    role,
    hookEventName,
  };
}
