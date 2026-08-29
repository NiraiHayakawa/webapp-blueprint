/**
 * Codex CLI PreToolUse hook の実行パイプライン。
 */
import { isRamuneModeActive } from "../../core/mode.ts";
import { evaluatePolicy } from "../../core/policy.ts";
import { formatCodexAllow, formatCodexDecision, formatCodexDeny } from "./formatter.ts";
import { resolveCodexRole } from "./role-resolver.ts";
import { parseCodexInput } from "./schema.ts";
import { mapCodexToolToAction } from "./tool-mapping.ts";

function evaluateActiveCodexPayload(rawInput: string): string {
  try {
    const input = parseCodexInput(rawInput);
    const role = resolveCodexRole(input);
    const action = mapCodexToolToAction(input.toolName);
    const decision = evaluatePolicy(action, role);
    return formatCodexDecision(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatCodexDeny(
      `ramune hooks (codex) はこのツール呼び出しを安全に判定できませんでした。` +
        `安全側に倒して拒否します。原因: ${message}`,
    );
  }
}

export function runCodexHook(rawInput: string, cwd?: string): string {
  const workingDirectory = cwd ?? process.cwd();

  let active: boolean;
  try {
    active = isRamuneModeActive(workingDirectory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatCodexDeny(
      `ramune モードの稼働/非稼働を判定できませんでした。安全側に倒して拒否します。原因: ${message}`,
    );
  }

  return active ? evaluateActiveCodexPayload(rawInput) : formatCodexAllow();
}
