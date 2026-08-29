/**
 * Antigravity PreToolUse hook 入力スキーマとパーサ。
 * 依存ゼロ制約（ADR 0004）に従い、手書きの型検証を行う。
 */
import type { RawToolInvocationPayload } from "../../core/actions.ts";

export class AntigravityInputParseError extends Error {
  constructor(reason: string) {
    super(`Antigravity PreToolUse hook 入力の解析に失敗しました: ${reason}`);
    this.name = "AntigravityInputParseError";
  }
}

export interface AntigravityInput {
  readonly toolName: string;
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- CLI ツール引数
  readonly toolArgs?: Record<string, unknown> | undefined;
  readonly subagentRole?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly workspacePaths?: readonly string[] | undefined;
  readonly stepIdx?: number | undefined;
}

interface RawAntigravityPayload {
  readonly conversationId?: unknown;
  readonly workspacePaths?: unknown;
  readonly toolCall?: unknown;
  readonly tool_name?: unknown;
  readonly stepIdx?: unknown;
  readonly subagent?: unknown;
  readonly agentType?: unknown;
  readonly subagentRole?: unknown;
}

interface RawSubagentPayload {
  readonly name?: unknown;
  readonly role?: unknown;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- 境界での型ガード
function isRecord(value: unknown): value is Record<string, unknown> {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRawPayload(raw: string): RawAntigravityPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AntigravityInputParseError(`stdin が JSON として解析できません（${String(error)}）`);
  }

  if (!isRecord(parsed)) {
    throw new AntigravityInputParseError("stdin の JSON がオブジェクトではありません");
  }

  return parsed;
}

function extractToolCall(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- 境界での型検証
  toolCall: unknown,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- CLI ツール引数
): readonly [toolName: string, toolArgs: Record<string, unknown> | undefined] {
  if (!isRecord(toolCall)) {
    throw new AntigravityInputParseError("toolCall がオブジェクトではありません");
  }
  const payload: RawToolInvocationPayload = toolCall;
  const rawName = payload.name;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  if (typeof rawName !== "string" || rawName.length === 0) {
    throw new AntigravityInputParseError("toolCall.name が非空文字列として存在しません");
  }
  const rawArgs = payload.args;
  const toolArgs = isRecord(rawArgs) ? rawArgs : undefined;

  return [rawName, toolArgs];
}

function resolveToolNameAndArgs(
  payload: RawAntigravityPayload,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- CLI ツール引数
): readonly [toolName: string, toolArgs: Record<string, unknown> | undefined] {
  if (payload.toolCall !== undefined) {
    return extractToolCall(payload.toolCall);
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  if (typeof payload.tool_name === "string" && payload.tool_name.length > 0) {
    return [payload.tool_name, undefined];
  }

  throw new AntigravityInputParseError("toolCall または tool_name が非空文字列として存在しません");
}

function extractFieldFromSubagentPayload(subagent: RawSubagentPayload): string | undefined {
  const nameValue = subagent.name;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  if (typeof nameValue === "string" && nameValue.length > 0) {
    return nameValue;
  }
  const roleValue = subagent.role;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  if (typeof roleValue === "string" && roleValue.length > 0) {
    return roleValue;
  }
  return undefined;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- 境界での型検証
function extractSubagentField(subagent: unknown): string | undefined {
  if (subagent === undefined) {
    return undefined;
  }
  if (!isRecord(subagent)) {
    throw new AntigravityInputParseError("subagent がオブジェクトではありません");
  }
  const payload: RawSubagentPayload = subagent;
  return extractFieldFromSubagentPayload(payload);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- 境界での型検証
function extractStringField(value: unknown): string | undefined {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveSubagentRole(payload: RawAntigravityPayload): string | undefined {
  return (
    extractSubagentField(payload.subagent) ??
    extractStringField(payload.agentType) ??
    extractStringField(payload.subagentRole)
  );
}

export function parseAntigravityInput(raw: string): AntigravityInput {
  const payload = parseRawPayload(raw);
  const [toolName, toolArgs] = resolveToolNameAndArgs(payload);
  const subagentRole = resolveSubagentRole(payload);

  const conversationId =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
    typeof payload.conversationId === "string" ? payload.conversationId : undefined;

  const stepIdx =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
    typeof payload.stepIdx === "number" ? payload.stepIdx : undefined;

  const workspacePaths = Array.isArray(payload.workspacePaths)
    ? // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
      payload.workspacePaths.filter((item): item is string => typeof item === "string")
    : undefined;

  return {
    toolName,
    toolArgs,
    subagentRole,
    conversationId,
    workspacePaths,
    stepIdx,
  };
}
