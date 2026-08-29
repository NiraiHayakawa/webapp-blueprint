/**
 * Claude Code PreToolUse hook 入力スキーマとパーサ。
 * 依存ゼロ制約（ADR 0004）に従い、手書きの型検証を行う。
 */

export class ClaudeInputParseError extends Error {
  constructor(reason: string) {
    super(`Claude PreToolUse hook 入力の解析に失敗しました: ${reason}`);
    this.name = "ClaudeInputParseError";
  }
}

export interface ClaudeInput {
  readonly toolName: string;
  readonly agentId?: string | undefined;
  readonly agentType?: string | undefined;
  readonly hookEventName?: string | undefined;
  readonly sessionId?: string | undefined;
}

interface RawClaudePayload {
  readonly hook_event_name?: unknown;
  readonly tool_name?: unknown;
  readonly agent_id?: unknown;
  readonly agent_type?: unknown;
  readonly session_id?: unknown;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- 境界での型ガード
function isRecord(value: unknown): value is Record<string, unknown> {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRawPayload(raw: string): RawClaudePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ClaudeInputParseError(`stdin が JSON として解析できません（${String(error)}）`);
  }

  if (!isRecord(parsed)) {
    throw new ClaudeInputParseError("stdin の JSON がオブジェクトではありません");
  }

  return parsed;
}

function assertHookEventName(payload: RawClaudePayload): void {
  const hookEventName = payload.hook_event_name;
  if (hookEventName !== "PreToolUse") {
    throw new ClaudeInputParseError(
      `hook_event_name が "PreToolUse" ではありません（実際: ${JSON.stringify(hookEventName)}）`,
    );
  }
}

function resolveToolName(payload: RawClaudePayload): string {
  const toolName = payload.tool_name;
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  if (typeof toolName !== "string" || toolName.length === 0) {
    throw new ClaudeInputParseError("tool_name が非空文字列として存在しません");
  }
  return toolName;
}

function resolveOptionalString(
  payload: RawClaudePayload,
  field: keyof RawClaudePayload,
): string | undefined {
  const value = payload[field];
  if (value === undefined) {
    return undefined;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- 依存ゼロ制約（ADR 0004）
  if (typeof value !== "string") {
    throw new ClaudeInputParseError(`${field} が文字列以外の型で存在します`);
  }
  return value;
}

export function parseClaudeInput(raw: string): ClaudeInput {
  const payload = parseRawPayload(raw);
  assertHookEventName(payload);

  return {
    toolName: resolveToolName(payload),
    agentId: resolveOptionalString(payload, "agent_id"),
    agentType: resolveOptionalString(payload, "agent_type"),
    hookEventName: "PreToolUse",
    sessionId: resolveOptionalString(payload, "session_id"),
  };
}
