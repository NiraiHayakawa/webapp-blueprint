// 外部プロセスの起動に失敗したときの型付きエラー（コマンドが存在しない、
// 出力が上限を超えた 等）。非ゼロ終了は「測定結果」でありこのエラーではない。
export class ProcessError extends Error {
  readonly command: readonly string[];

  constructor(command: readonly string[], reason: string) {
    super(`プロセスを実行できませんでした（${reason}）: ${command.join(" ")}`);
    this.name = "ProcessError";
    this.command = command;
  }
}
