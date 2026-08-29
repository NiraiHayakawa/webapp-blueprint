import type { AppException, SafeFields } from "./app-exception.js";

/**
 * client に返してよい形。**`logDetails` に対応するフィールドを型として
 * 持たない**（AppException.details だけを転記する）ため、呼び出し側は
 * server only の情報へ構造的にアクセスできない。
 */
interface ApiErrorResponse {
  readonly code: string;
  readonly statusCode: number;
  readonly details: SafeFields;
}

/** AppException → API エラー応答（design 報告の境界図の左側の枝）。 */
function toApiErrorResponse(appException: Readonly<AppException>): ApiErrorResponse {
  return {
    code: appException.code,
    statusCode: appException.statusCode,
    details: appException.details,
  };
}

export { toApiErrorResponse };
