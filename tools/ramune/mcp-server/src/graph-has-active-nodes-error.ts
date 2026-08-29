// ramune_apply_ops が投げるエラー: グラフに実行中のノード
// （running / awaiting_integration / integrating）が 1 件でも存在するため、
// 構造操作列の適用を拒否した（設計正本 §8 の ramune_apply_ops の契約）。
//
// Planner が構造を組み替えてよいのは、どのノードも実行されていないときだけである。
//
// store.ts から分離しているエラークラスと同じく、1 ファイル 1 クラスの原則
// （eslint/max-classes-per-file）に合わせるためであり、拡張はファイルの追加で
// 表現する（docs/principles/extension-adds-files.md）。

export class GraphHasActiveNodesError extends Error {
  readonly nodeIds: readonly string[];

  constructor(nodeIds: readonly string[]) {
    super(
      `実行中のノード（running / awaiting_integration / integrating）が存在するため操作列を適用しない: ${nodeIds.join(", ")}`,
    );
    this.name = "GraphHasActiveNodesError";
    this.nodeIds = nodeIds;
  }
}
