// revision の加算 overflow を表す型付きエラー。transaction.ts から分離
// （max-classes-per-file 対応。挙動変更なし）。

/** revision の加算が safe integer の上限に達した。fail-closed で拒否する（§2.8）。 */
export class RevisionOverflowError extends Error {
  constructor(revision: number) {
    super(
      `revision が上限（Number.MAX_SAFE_INTEGER）に達したため加算できない: revision=${String(revision)}`,
    );
    this.name = "RevisionOverflowError";
  }
}

/** 呼び出し側がクラス自体をインポートせずに overflow エラーを投げるためのファクトリ。 */
export function throwRevisionOverflowError(revision: number): never {
  throw new RevisionOverflowError(revision);
}
