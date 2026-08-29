/**
 * PreToolUse フックのロール判定 shim。
 * core/role.ts と adapters/claude/ へ委譲する。
 */
export type { Role } from "./core/role.ts";

export {
  ClaudeInputParseError as HookInputParseError,
  parseClaudeInput as parsePreToolUseHookInput,
  resolveClaudeRole as determineRole,
  type ClaudeInput as PreToolUseHookInput,
} from "./adapters/claude/index.ts";

export interface RawPreToolUseInput {
  readonly hook_event_name?: unknown;
  readonly tool_name?: unknown;
  readonly agent_id?: unknown;
  readonly agent_type?: unknown;
}
