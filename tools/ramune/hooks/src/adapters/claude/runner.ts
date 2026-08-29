/**
 * Claude Code PreToolUse hook の実行パイプライン。
 * セッションモード判定を行い、稼働中は入力の検証からポリシー判定、出力の構築までを調整し、
 * 例外を fail-closed な deny 出力に変換する。
 */
import { isRamuneModeActive } from "../../core/mode.ts";
import { evaluatePolicy } from "../../core/policy.ts";
import { formatClaudeAllow, formatClaudeDecision, formatClaudeDeny } from "./formatter.ts";
import { resolveClaudeRole } from "./role-resolver.ts";
import { parseClaudeInput } from "./schema.ts";
import { mapClaudeToolToAction } from "./tool-mapping.ts";

function evaluateActiveClaudePayload(rawInput: string): string {
  try {
    const input = parseClaudeInput(rawInput);
    const role = resolveClaudeRole(input);
    const action = mapClaudeToolToAction(input.toolName);
    const decision = evaluatePolicy(action, role);
    return formatClaudeDecision(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatClaudeDeny(
      `ramune hooks (claude) はこのツール呼び出しを安全に判定できませんでした。` +
        `安全側に倒して拒否します。原因: ${message}`,
    );
  }
}

export function runClaudeHook(rawInput: string, cwd?: string): string {
  const workingDirectory = cwd ?? process.cwd();

  let active: boolean;
  try {
    active = isRamuneModeActive(workingDirectory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatClaudeDeny(
      `ramune モードの稼働/非稼働を判定できませんでした。安全側に倒して拒否します。原因: ${message}`,
    );
  }

  return active ? evaluateActiveClaudePayload(rawInput) : formatClaudeAllow();
}
