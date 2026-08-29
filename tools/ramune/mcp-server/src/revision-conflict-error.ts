// GraphStore.transaction() が投げるエラー: expected_revision で提示した revision が、
// 実際に読み込んだグラフの revision と一致しない（設計正本 §4「判断系の OCC」）。
//
// mismatch は型付きエラーであり、store は自動リトライしない。呼び出し側が
// グラフを読み直して判断からやり直す。
//
// store.ts から分離しているのは 1 ファイル 1 クラスの原則
// （eslint/max-classes-per-file）に合わせるためであり、拡張はファイルの
// 追加で表現する（docs/principles/extension-adds-files.md）。

export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `revision の不一致（expected: ${String(expectedRevision)}, actual: ${String(actualRevision)}）。` +
        "自動リトライはしない。グラフを読み直して判断からやり直すこと",
    );
    this.name = "RevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}
