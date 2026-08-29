// GraphStore が投げるエラー: .ramune/graph.json の version が 2 以外の状態。
//
// 設計正本 §2「version !== 2 のグラフは、いかなる変更操作よりも先に拒否する」の
// 受け皿（store 側）。graph パッケージの parseGraph も version を検証するが、
// こちらは「ファイルとして読む前の段階」で raw JSON の version フィールドを先に
// 眺めることで、スキーマ検査に掛かる前に v1 等を名指しで拒否できる。v1 ファイルは
// archiveUnsupportedVersion() で raw のまま退避する明示操作の対象になる。
//
// store.ts から分離しているのは 1 ファイル 1 クラスの原則
// （eslint/max-classes-per-file）に合わせるためであり、拡張はファイルの
// 追加で表現する（docs/principles/extension-adds-files.md）。

export class UnsupportedGraphVersionError extends Error {
  readonly filePath: string;
  readonly actualVersion: number;

  constructor(filePath: string, actualVersion: number) {
    super(
      `${filePath} の graph version は ${String(actualVersion)} であり、このサーバーは version 2 のみを扱う。` +
        "migration は存在しない。GraphStore.archiveUnsupportedVersion() で raw のまま退避してから初期化すること",
    );
    this.name = "UnsupportedGraphVersionError";
    this.filePath = filePath;
    this.actualVersion = actualVersion;
  }
}
