/**
 * ramune hook 評価コーディネータ。
 * 作業ディレクトリからのモード判定（非稼働時は allow、判定エラー時は fail-closed deny）と
 * ロール×抽象アクションに対するポリシールール評価を統合する。
 */
import type { ActionType } from "./actions.ts";
import type { Role } from "./role.ts";
import type { Decision } from "./policy.ts";
import { evaluatePolicy } from "./policy.ts";
import { isRamuneModeActive } from "./mode.ts";

export interface HookEvaluationContext {
  readonly workingDirectory: string;
  readonly role: Role;
  readonly action: ActionType;
}

type ModeResolution = { readonly active: boolean } | { readonly errorReason: string };

function determineActiveMode(workingDirectory: string): ModeResolution {
  try {
    return { active: isRamuneModeActive(workingDirectory) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      errorReason: `ramune モードの稼働/非稼働を判定できませんでした。安全側に倒して拒否します。原因: ${message}`,
    };
  }
}

function evaluatePolicySafely(action: ActionType, role: Role): Decision {
  try {
    return evaluatePolicy(action, role);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      decision: "deny",
      reason: `ramune hook (policy) の評価中にエラーが発生しました。安全側に倒して拒否します。原因: ${message}`,
    };
  }
}

/**
 * クライアント非依存の hook 評価エントリポイント。
 * - セッション非稼働時: ツールを制限せず `{ decision: "allow" }` を返す。
 * - セッション稼働時: ロールとアクションに基づき `evaluatePolicy` を適用する。
 * - ロケータやモード判定の例外発生時: fail-closed 原則に基づき `{ decision: "deny", reason: "..." }` を返す。
 */
export function evaluateHookRequest(ctx: HookEvaluationContext): Decision {
  const modeResult = determineActiveMode(ctx.workingDirectory);
  if ("errorReason" in modeResult) {
    return { decision: "deny", reason: modeResult.errorReason };
  }
  if (!modeResult.active) {
    return { decision: "allow" };
  }
  return evaluatePolicySafely(ctx.action, ctx.role);
}
