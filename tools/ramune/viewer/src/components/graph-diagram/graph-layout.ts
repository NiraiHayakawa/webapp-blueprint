// DAG の座標計算。描画（graph-diagram.ts）から分けている理由は2つある。
// 「どこに置くか」と「どう描くか」は変更理由が独立していること、そして
// 1ファイルの行数上限（codopsy の max-lines。mise run check:complexity）に
// 収めるため。
import type { GraphNode } from "../../lib/graph-source/graph-source.ts";

const NODE_RADIUS = 24;
const COLUMN_WIDTH = 160;
const ROW_HEIGHT = 80;
const MARGIN = 48;

interface NodeLayout {
  readonly node: GraphNode;
  readonly x: number;
  readonly y: number;
}

function getNodeOrThrow(nodeById: ReadonlyMap<string, GraphNode>, id: string): GraphNode {
  const node = nodeById.get(id);
  if (node === undefined) {
    throw new Error(`存在しないノード "${id}" への依存を検出した`);
  }
  return node;
}

/**
 * 各ノードの「レベル」= start からの最長経路長。DAG 不変条件（サイクル禁止）
 * は @webapp-blueprint/ramune-graph が適用前検査で保証するが、viewer 自身も描画
 * 不能な入力を黙って描画しない（fail-fast。原則2）ため、循環参照を検出したら
 * 明示的に例外を投げる。
 */
function getCachedLevel(
  levels: ReadonlyMap<string, number>,
  visiting: ReadonlySet<string>,
  id: string,
): number | undefined {
  const cached = levels.get(id);
  if (cached !== undefined) {
    return cached;
  }
  if (visiting.has(id)) {
    throw new Error(`グラフにサイクルが含まれている（ノード "${id}" を再訪した）`);
  }
  return undefined;
}

/*similarity-ignore: グラフ/木を走査して集めるという形が似ているだけで、変更理由は完全に
 * 独立している（描画の都合 / ドメイン不変条件 / AST解析）。tools/ramune/viewer・
 * tools/ramune/graph・tools/architecture の3パッケージにまたがり、依存の向き的にも
 * 共通化すると不適切な結合を生むため similarity（重複検出）の指摘を抑制する。
 * 共通化すべき重複ではなく、「たまたま形が似ているだけ」の事例として扱う判断による。*/
function computeLevels(nodes: readonly GraphNode[]): ReadonlyMap<string, number> {
  const nodeById = new Map(nodes.map((node): readonly [string, GraphNode] => [node.id, node]));
  const levels = new Map<string, number>();
  const visiting = new Set<string>();

  function levelOf(id: string): number {
    const cached = getCachedLevel(levels, visiting, id);
    if (cached !== undefined) {
      return cached;
    }
    const node = getNodeOrThrow(nodeById, id);
    visiting.add(id);
    const level = node.deps.length === 0 ? 0 : Math.max(...node.deps.map(levelOf)) + 1;
    visiting.delete(id);
    levels.set(id, level);
    return level;
  }

  for (const node of nodes) {
    levelOf(node.id);
  }
  return levels;
}

/*similarity-ignore: computeLevels と同じ理由（走査の形が似ているだけ）。*/
function computeLayout(nodes: readonly GraphNode[]): readonly NodeLayout[] {
  const levels = computeLevels(nodes);
  const countByLevel = new Map<number, number>();
  return nodes.map((node) => {
    const level = levels.get(node.id) ?? 0;
    const indexInLevel = countByLevel.get(level) ?? 0;
    countByLevel.set(level, indexInLevel + 1);
    return {
      node,
      x: MARGIN + NODE_RADIUS + level * COLUMN_WIDTH,
      y: MARGIN + NODE_RADIUS + indexInLevel * ROW_HEIGHT,
    };
  });
}

/** SVG の viewBox に渡す寸法。 */
interface ViewBox {
  readonly width: number;
  readonly height: number;
}

function computeViewBox(layouts: readonly NodeLayout[]): ViewBox {
  const width = Math.max(...layouts.map((layout) => layout.x)) + NODE_RADIUS + MARGIN;
  const height = Math.max(...layouts.map((layout) => layout.y)) + NODE_RADIUS + MARGIN;
  return { width, height };
}

/** レイアウト済みノードを id から引く。deps が指す先が無ければ fail-fast する。 */
function getLayoutOrThrow(layoutById: ReadonlyMap<string, NodeLayout>, id: string): NodeLayout {
  const layout = layoutById.get(id);
  if (layout === undefined) {
    throw new Error(`存在しないノード "${id}" への依存を検出した`);
  }
  return layout;
}

export { NODE_RADIUS, computeLayout, computeViewBox, getLayoutOrThrow };
export type { NodeLayout };
