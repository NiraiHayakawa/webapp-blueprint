/**
 * Claude Code PreToolUse hook shim。
 * core と adapters/claude/ へ委譲する。
 */
import { evaluatePolicy } from "./core/policy.ts";
import { formatClaudeDecision, formatClaudeDeny } from "./adapters/claude/formatter.ts";
import { resolveClaudeRole } from "./adapters/claude/role-resolver.ts";
import { parseClaudeInput } from "./adapters/claude/schema.ts";
import { mapClaudeToolToAction } from "./adapters/claude/tool-mapping.ts";
import { runClaudeHook } from "./adapters/claude/runner.ts";
import { main } from "./adapters/claude/main.ts";

export function runPreToolUseHook(raw: string): string {
  try {
    const input = parseClaudeInput(raw);
    const role = resolveClaudeRole(input);
    const action = mapClaudeToolToAction(input.toolName);
    const decision = evaluatePolicy(action, role);
    return formatClaudeDecision(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatClaudeDeny(
      `ramune hooks (pre-tool-use) はこのツール呼び出しを安全に判定できませんでした。` +
        `安全側に倒して拒否します。原因: ${message}`,
    );
  }
}

export function runHook(raw: string, sessionWorkingDirectory: string): string {
  return runClaudeHook(raw, sessionWorkingDirectory);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
