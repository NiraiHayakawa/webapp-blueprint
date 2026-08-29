// 測定値を mise run check の証跡に変換できないときの型付きエラー。
// 証跡の command フィールド（literal "mise run check"）は「実行したコマンド」の
// 宣言であるため、別コマンドの測定値にこの名前を冠させることは許さない。
export class VerificationEvidenceError extends Error {
  readonly executedCommand: readonly string[];

  constructor(executedCommand: readonly string[]) {
    super(
      `実行されたコマンド（${executedCommand.join(" ")}）は mise run check ではないため、` +
        'command が "mise run check" の証跡にはできません。',
    );
    this.name = "VerificationEvidenceError";
    this.executedCommand = executedCommand;
  }
}
