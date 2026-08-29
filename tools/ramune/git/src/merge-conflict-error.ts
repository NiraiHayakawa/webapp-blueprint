// 統合 merge の conflict（設計正本 §6.3）。conflict は失敗の隠蔽ではなく
// 正常系の一部であるため、競合ファイル一覧を観測可能な形で運ぶ。
import type { RepoPath } from "@webapp-blueprint/ramune-graph";

export class MergeConflictError extends Error {
  readonly conflictedFiles: readonly RepoPath[];

  constructor(conflictedFiles: readonly RepoPath[]) {
    super(
      `統合 merge で conflict しました（${conflictedFiles.join(", ")}）。` +
        "cleanup 後に ramune_record_integration_outcome へ conflict を記録してください（§6.3）。",
    );
    this.name = "MergeConflictError";
    this.conflictedFiles = conflictedFiles;
  }
}
