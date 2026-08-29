// 検証コマンドが証跡化できない終わり方をしたときの型付きエラー
// （シグナルによる死亡・起動失敗・出力上限超過。設計正本 §6.2 step 3）。
export class VerificationProcessError extends Error {
  readonly command: readonly string[];
  readonly reason: string;

  constructor(command: readonly string[], reason: string) {
    super(`検証コマンドを証跡化できませんでした（${command.join(" ")}）: ${reason}`);
    this.name = "VerificationProcessError";
    this.command = command;
    this.reason = reason;
  }
}
