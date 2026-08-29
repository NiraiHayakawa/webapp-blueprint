// resume_session の epoch 加算が safe integer の上限に達した場合の型付きエラー。
// operation 本体（resume-session.ts）から分離（max-classes-per-file 対応。挙動変更なし）。

/** epoch の加算が safe integer の上限に達した。fail-closed。 */
export class EpochOverflowError extends Error {
  override readonly name = "EpochOverflowError";
}
