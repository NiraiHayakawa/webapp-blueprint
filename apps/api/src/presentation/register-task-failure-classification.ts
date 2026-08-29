import { AppException } from "../logging/app-exception.js";
import type { FailureReason } from "../logging/failure-reason.js";
import { TaskTitleEmptyError } from "../domain/task/task-title-empty.error.js";
import { TaskTitleTooLongError } from "../domain/task/task-title-too-long.error.js";
import { TaskRepositoryUnavailableError } from "../application/register-task/task-repository-unavailable.error.js";

const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;

/**
 * register-task ユースケース専用の、生の例外 → AppException 変換。
 * この関数が「UseCase → AppException」境界の唯一の場所であり、業務コード
 * （ハンドラ・use case）はここを経由せずに AppException を作らない
 * （design 報告の境界図）。
 *
 * ここに現れない例外は分類漏れであり、fail-fast（原則2）としてそのまま
 * rethrow する。未知の失敗を汎用の AppException へ丸めて隠さない。
 *
 * 引数名 `cause` の理由は observe.ts の ObserveResultParams を参照
 * （これは throw された生の値そのものであり、`unknown` より狭い型を
 * 名乗らせることはできない）。
 */
function classifyRegisterTaskFailure(cause: unknown): AppException {
  if (cause instanceof TaskTitleEmptyError) {
    return new AppException({
      code: "TASK_TITLE_EMPTY",
      statusCode: HTTP_STATUS_BAD_REQUEST,
      reasons: new Set<FailureReason>(["invalid-input"]),
      details: { field: "title" },
      logDetails: { rawErrorName: cause.name },
    });
  }

  if (cause instanceof TaskTitleTooLongError) {
    return new AppException({
      code: "TASK_TITLE_TOO_LONG",
      statusCode: HTTP_STATUS_BAD_REQUEST,
      reasons: new Set<FailureReason>(["invalid-input"]),
      details: { field: "title" },
      logDetails: { rawErrorName: cause.name },
    });
  }

  if (cause instanceof TaskRepositoryUnavailableError) {
    return new AppException({
      code: "TASK_STORAGE_UNAVAILABLE",
      statusCode: HTTP_STATUS_SERVICE_UNAVAILABLE,
      reasons: new Set<FailureReason>(["storage-unavailable", "retry-exhausted"]),
      details: { resource: "task" },
      logDetails: { attempts: cause.attempts },
    });
  }

  throw cause;
}

export { classifyRegisterTaskFailure };
