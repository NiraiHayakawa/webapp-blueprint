/**
 * Antigravity PreToolUse hook の実行パイプライン。
 */
import { isRamuneModeActive } from "../../core/mode.ts";
import { evaluatePolicy } from "../../core/policy.ts";
import {
  formatAntigravityAllow,
  formatAntigravityDecision,
  formatAntigravityDeny,
} from "./formatter.ts";
import { resolveAntigravityRole } from "./role-resolver.ts";
import { parseAntigravityInput } from "./schema.ts";
import { mapAntigravityToolToAction } from "./tool-mapping.ts";

function evaluateActiveAntigravityPayload(rawInput: string): string {
  try {
    const input = parseAntigravityInput(rawInput);
    const role = resolveAntigravityRole(input);
    const action = mapAntigravityToolToAction(input.toolName);
    const decision = evaluatePolicy(action, role);
    return formatAntigravityDecision(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatAntigravityDeny(
      `ramune hooks (antigravity) はこのツール呼び出しを安全に判定できませんでした。` +
        `安全側に倒して拒否します。原因: ${message}`,
    );
  }
}

export function runAntigravityHook(rawInput: string, cwd?: string): string {
  const workingDirectory = cwd ?? process.cwd();

  let active: boolean;
  try {
    active = isRamuneModeActive(workingDirectory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatAntigravityDeny(
      `ramune モードの稼働/非稼働を判定できませんでした。安全側に倒して拒否します。原因: ${message}`,
    );
  }

  return active ? evaluateActiveAntigravityPayload(rawInput) : formatAntigravityAllow();
}
