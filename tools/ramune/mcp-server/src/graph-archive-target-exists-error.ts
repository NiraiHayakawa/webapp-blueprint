// GraphStore.archiveUnsupportedVersion() が投げるエラー: 退避先のファイルが
// 既に存在する。既存の退避ファイルを黙って上書きすると前回の退避内容が失われる
// ため、raw バイトの保護を優先し失敗する（docs/principles/fail-fast.md）。
//
// store.ts から分離しているのは 1 ファイル 1 クラスの原則
// （eslint/max-classes-per-file）に合わせるためであり、拡張はファイルの
// 追加で表現する（docs/principles/extension-adds-files.md）。

export class GraphArchiveTargetExistsError extends Error {
  readonly archivedTo: string;

  constructor(archivedTo: string) {
    super(
      `退避先 ${archivedTo} が既に存在する。既存の退避ファイルを上書きはしない。` +
        "手動で退避ファイルを確認・移動してから再実行すること",
    );
    this.name = "GraphArchiveTargetExistsError";
    this.archivedTo = archivedTo;
  }
}
