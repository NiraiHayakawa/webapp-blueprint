// git コマンドの失敗。exit code と stderr を観測可能なまま保持する
// （呼び出し側のエラー文言と調査ログの材料になる）。
export interface GitCommandFailure {
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderrText: string;
  readonly detail?: string;
}

export class GitCommandError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderrText: string;

  constructor(failure: GitCommandFailure) {
    const suffix = failure.detail ?? `stderr: ${failure.stderrText.trim()}`;
    super(`git コマンドが失敗しました（${failure.args.join(" ")}）: ${suffix}`);
    this.name = "GitCommandError";
    this.args = failure.args;
    this.exitCode = failure.exitCode;
    this.stderrText = failure.stderrText;
  }
}
