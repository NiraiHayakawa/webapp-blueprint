// allocator（nextAllocationId）の枯渇を表す型付きエラー。transaction.ts から
// 分離（max-classes-per-file 対応。挙動変更なし）。

/** 発番が safe integer の上限に達した。allocator の枯渇は自動的には回復しない。 */
export class AllocationExhaustedError extends Error {
  constructor(nextAllocationId: number) {
    super(
      `allocator が上限（Number.MAX_SAFE_INTEGER）に達したため発番できない: nextAllocationId=${String(nextAllocationId)}`,
    );
    this.name = "AllocationExhaustedError";
  }
}

/** 呼び出し側がクラス自体をインポートせずに枯渇エラーを投げるためのファクトリ。 */
export function throwAllocationExhaustedError(nextAllocationId: number): never {
  throw new AllocationExhaustedError(nextAllocationId);
}
