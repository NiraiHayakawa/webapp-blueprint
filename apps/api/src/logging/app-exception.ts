import type { FailureReason } from "./failure-reason.js";
import { EmptyFailureReasonSetError } from "./empty-failure-reason-set.error.js";

/**
 * ログ・API 応答のフィールド値として許す型。ネストしたオブジェクトや
 * 生の Error を禁止することで、シリアライザが安全なフィールドしか
 * 作れない状態を型で担保する（原則12: 「生の例外の cause を構造体に含めない」）。
 */
type SafeFieldValue = string | number | boolean;
type SafeFields = Readonly<Record<string, SafeFieldValue>>;

interface AppExceptionInit {
  /** 閉じた語彙のエラーコード（レビュー観点: 監視条件はこの値で組む）。 */
  readonly code: string;
  readonly statusCode: number;
  readonly reasons: ReadonlySet<FailureReason>;
  /** client に返してよいフィールド（原則12: 外向け details）。 */
  readonly details: SafeFields;
  /** server only。client 応答には現れない（{@link toApiErrorResponse} 参照）。 */
  readonly logDetails: SafeFields;
}

function validateReasons(reasons: ReadonlySet<FailureReason>): ReadonlySet<FailureReason> {
  if (reasons.size === 0) {
    throw new EmptyFailureReasonSetError();
  }
  return reasons;
}

/**
 * 外向け（details）と内向け（logDetails）を型で分ける（原則12: client-facing details vs internal logDetails）。
 * この 2 つを混ぜて同じ経路に流すコードを書けないようにするのが目的で、
 * 実際に分ける処理は {@link toApiErrorResponse} と観測境界（observe.ts）の
 * それぞれが個別の経路で行う。
 */
// oxlint-disable-next-line unicorn/custom-error-definition -- 原則12・design報告の語彙(AppException)に揃えるため *Error へ改名しない
class AppException extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly reasons: ReadonlySet<FailureReason>;
  public readonly details: SafeFields;
  public readonly logDetails: SafeFields;

  public constructor(init: Readonly<AppExceptionInit>) {
    super(init.code);
    this.name = "AppException";
    this.code = init.code;
    this.statusCode = init.statusCode;
    this.reasons = validateReasons(init.reasons);
    this.details = init.details;
    this.logDetails = init.logDetails;
  }
}

export { AppException };
export type { SafeFields, SafeFieldValue };
