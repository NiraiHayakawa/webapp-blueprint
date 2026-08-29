// Node.js の fs / process 系 API が投げる ErrnoException かどうかの型ガード。
// `as NodeJS.ErrnoException` の直接キャストは、実際には検査していない不変条件
// （`code` プロパティを持つこと）を主張することになるため使わない。
//
// anti-slop/no-unknown-parameters は「境界で parse していない unknown 入力」を
// 検出するルールだが、この関数自体が catch 節の unknown を検査して境界を作る
// 型ガードであり、抑制対象の意図（無検査のまま値を運ぶ）には当たらない。
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- 上のコメント参照。
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
