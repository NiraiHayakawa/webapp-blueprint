// GraphStore.load() が投げるエラー: .ramune/graph.json の中身が Graph の形を
// 満たさない状態（docs/principles/fail-fast.md「握りつぶさず明確に失敗する」）。
//
// store.ts から分離しているのは 1 ファイル 1 クラスの原則
// （eslint/max-classes-per-file）に合わせるためであり、拡張はファイルの
// 追加で表現する（docs/principles/extension-adds-files.md）。

export class GraphFileCorruptedError extends Error {
  constructor(filePath: string, detail: string) {
    super(`${filePath} の内容が Graph の形を満たさない: ${detail}`);
    this.name = "GraphFileCorruptedError";
  }
}
