// abandon_assignment の前提条件違反と型付きエラー。operation 本体
// （abandon-assignment.ts）から分離（codopsy max-lines 対応。挙動変更なし）。

export type AbandonAssignmentPreconditionViolation =
  | { readonly reason: "node_not_found"; readonly nodeId: string }
  | {
      readonly reason: "stale_fence";
      readonly nodeId: string;
      readonly status: string;
    }
  | { readonly reason: "observed_git_required"; readonly nodeId: string }
  | { readonly reason: "unnecessary_observed_git"; readonly nodeId: string }
  | { readonly reason: "broken_resolution_chain"; readonly nodeId: string };

export class AbandonAssignmentPreconditionError extends Error {
  readonly violation: AbandonAssignmentPreconditionViolation;

  constructor(violation: AbandonAssignmentPreconditionViolation) {
    super(`abandon_assignment の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "AbandonAssignmentPreconditionError";
    this.violation = violation;
  }
}

/** 呼び出し側がクラス自体をインポートせずに前提条件違反を投げるためのファクトリ。 */
export function throwAbandonAssignmentPreconditionError(
  violation: AbandonAssignmentPreconditionViolation,
): never {
  throw new AbandonAssignmentPreconditionError(violation);
}
