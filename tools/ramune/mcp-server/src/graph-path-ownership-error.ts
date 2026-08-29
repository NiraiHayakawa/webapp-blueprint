// ramune MCP サーバーが投げるエラー: 起動しようとしたディレクトリが
// canonical な graph 配置パスの所有者ではない（設計正本 §5「サーバは起動時に
// graph の配置パスを自分の所有として検査し、所有の不一致は fail-closed で
// 拒否する」）。
//
// 具体的な不一致は2種類:
//   - repositoryRoot が git リポジトリルートでない（.git が無い）
//   - 同じ .ramune/ 配置パスを別の生きているサーバープロセスが既に所有している
//     （所有マーカーファイルの pid が生存している。ownership.ts 参照）
//
// store.ts 周辺のエラークラスと同じく、1 ファイル 1 クラスの原則に従い分離する。

export class GraphPathOwnershipError extends Error {
  readonly repositoryRoot: string;
  readonly detail: string;

  constructor(repositoryRoot: string, detail: string) {
    super(`${repositoryRoot} は canonical な graph 配置パスの所有者として起動できない: ${detail}`);
    this.name = "GraphPathOwnershipError";
    this.repositoryRoot = repositoryRoot;
    this.detail = detail;
  }
}
