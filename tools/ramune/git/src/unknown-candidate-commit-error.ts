// candidate commit がリポジトリのオブジェクト DB に存在しないときの型付きエラー。
import type { CommitId } from "@webapp-blueprint/ramune-graph";

export class UnknownCandidateCommitError extends Error {
  readonly candidateCommit: CommitId;

  constructor(candidateCommit: CommitId) {
    super(
      `candidate commit ${candidateCommit} がリポジトリに存在しません。` +
        "candidate は隔離 worktree とオブジェクト DB を共有するため、submit 済みのコミットは解決できるはずです。",
    );
    this.name = "UnknownCandidateCommitError";
    this.candidateCommit = candidateCommit;
  }
}
