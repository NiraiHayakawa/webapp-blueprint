// GraphStore.load() が投げるエラー: ファイルが存在せず、初期化用の goal も
// 指定されていない状態（docs/principles/fail-fast.md「デフォルト値フォール
// バックの禁止」— goal を空文字列等で埋めて継続しない）。
//
// store.ts から分離しているのは 1 ファイル 1 クラスの原則
// （eslint/max-classes-per-file）に合わせるためであり、拡張はファイルの
// 追加で表現する（docs/principles/extension-adds-files.md）。

export class GraphNotInitializedError extends Error {
  constructor(filePath: string) {
    super(
      `${filePath} が存在せず、初期化用の goal も指定されていない。` +
        "GraphStore の呼び出し元（サーバー起動時の設定）で goal を渡すか、" +
        "先に .ramune/graph.json を作成すること",
    );
    this.name = "GraphNotInitializedError";
  }
}
