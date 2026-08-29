import { createGraphSource } from "../lib/graph-source/graph-source.ts";
import { loadGraphView } from "../features/graph-view/index.ts";
import { parseSelectedNodeId } from "../lib/selected-node/selected-node.ts";

/**
 * apps/web/src/routes/index.ts の `Route` と構造が一致し similarity-ts が
 * 検出するが、これは §3「フロントエンド: 再帰的 features」が routes/ に
 * 意図的に課している最小形（path + render だけ）であり、両者は独立した
 * デプロイ単位（apps/web はテンプレートの最小縦切りで削除可能、
 * tools/ramune/viewer は ramune のハーネス）で変更理由が異なる
 * （design §5「similarity-ts（重複検出）」の2番目の対応「重複を残し、
 * 理由つきで抑制する」）。将来 apps/ 配下に別のフロントエンドが増えても
 * 同じ最小形の Route を独立に持つことが想定されており、共通化すると
 * 逆に「routes/ は薄く保つ」という規約より共有型への依存を優先することになる。
 */
// similarity-ignore
export interface Route {
  readonly path: string;
  readonly render: () => Promise<string>;
}

// ルーティングは薄く、feature を並べるだけにする。
export const routes: readonly Route[] = [
  {
    path: "/",
    // フラグメントは描画のたびに読み直す（再描画で開閉状態を失わないため。
    // lib/selected-node/selected-node.ts 参照）。
    render: async () =>
      await loadGraphView({
        graphSource: createGraphSource(),
        selectedNodeId: parseSelectedNodeId(globalThis.location.hash),
      }),
  },
];
