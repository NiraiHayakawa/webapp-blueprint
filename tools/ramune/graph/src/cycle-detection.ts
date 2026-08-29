// サイクル検出は node -> その deps の向きに DFS する（node は deps に依存するので、
// 「node が自分自身に依存し戻る経路」を白/灰/黒の3色訪問で見つける標準アルゴリズム）。
// dangling な depId（存在しないノードへの参照）は invariants.ts の
// findDanglingDependencies が別途報告するため、ここでは無視して探索を続ける
// （同じ問題を二重に違反として出さないための切り分け）。
//
// invariants.ts から切り出しているのは、invariants.ts が eslint/max-lines
// （原則7「拡張はファイルの追加で表現される。既存ファイルの行数純増は
// 分割サイン」）の閾値を超えたためであり、サイクル検出はそれ単体で
// 完結した責務（独立したアルゴリズム）である。
/*similarity-ignore: グラフ/木を走査して集めるという形が似ているだけで、変更理由は完全に
 * 独立している（描画の都合 / ドメイン不変条件 / AST解析）。apps/viewer・packages/graph・
 * tools/architecture の3パッケージにまたがり、依存の向き的にも共通化すると不適切な結合を
 * 生むため similarity（重複検出）の指摘を抑制する。共通化すべき重複ではなく、
 * 「たまたま形が似ているだけ」の事例として扱う判断による。*/
import type { InvariantViolation } from "./invariant-violation.ts";

/** deps ベースのグラフ走査に必要な最小限のノード形（boundary / task 両方で使える）。 */
export interface DepsBearingNode {
  readonly id: string;
  readonly deps: readonly string[];
}

// visitForCycle / visitDependenciesForCycle が共有する DFS の実行状態。
// 3個以上の個別引数を並べる代わりに1個のオブジェクトにまとめているのは
// eslint/max-params（1関数あたりの許容引数数）に収めるためであり、
// 3つの値はいずれも「今回の findCycles 呼び出し1回分の状態」という
// 単一のライフサイクルを共有するので、まとめること自体が不自然ではない。
interface CycleSearchContext {
  readonly byId: ReadonlyMap<string, DepsBearingNode>;
  readonly state: Map<string, "visiting" | "done">;
  readonly stack: string[];
}

// visitForCycle が現在の DFS パス（stack）に自分自身を見つけたときに、
// サイクルそのもの（stack のうち id 以降の部分 + id）を組み立てる。
function buildCycleFrom(stack: readonly string[], id: string): readonly string[] {
  const cycleStart = stack.indexOf(id);
  return [...stack.slice(cycleStart), id];
}

function beginVisit(ctx: CycleSearchContext, id: string): void {
  ctx.state.set(id, "visiting");
  ctx.stack.push(id);
}

function endVisit(ctx: CycleSearchContext, id: string): void {
  ctx.stack.pop();
  ctx.state.set(id, "done");
}

// visitForCycle と互いに再帰する（id の各 depId を訪問し、そこから先で
// サイクルが見つかったら visitForCycle を呼ぶ）ため、どちらを先に定義しても
// もう一方への前方参照が残る。オブジェクト指向言語のメソッド間相互再帰と
// 同じ形であり、トップレベル関数の定義順で読みやすさを保つという
// no-use-before-define の目的とはそもそも噛み合わない箇所であるため、
// この1箇所（visitForCycle への前方参照）だけを行単位で抑制する。
function visitDependenciesForCycle(
  id: string,
  ctx: CycleSearchContext,
): readonly string[] | undefined {
  const node = ctx.byId.get(id);
  if (!node) {
    return undefined;
  }
  for (const depId of node.deps) {
    if (!ctx.byId.has(depId)) {
      continue;
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- 上のコメント参照。
    const cycle = visitForCycle(depId, ctx);
    if (cycle) {
      return cycle;
    }
  }
  return undefined;
}

function visitForCycle(id: string, ctx: CycleSearchContext): readonly string[] | undefined {
  const current = ctx.state.get(id);
  if (current === "done") {
    return undefined;
  }
  if (current === "visiting") {
    return buildCycleFrom(ctx.stack, id);
  }

  beginVisit(ctx, id);
  const cycle = visitDependenciesForCycle(id, ctx);
  endVisit(ctx, id);
  return cycle;
}

export function findCycles(nodes: readonly DepsBearingNode[]): readonly InvariantViolation[] {
  const ctx: CycleSearchContext = {
    byId: new Map(nodes.map((node) => [node.id, node] as const)),
    state: new Map(),
    stack: [],
  };

  for (const node of nodes) {
    const cycle = visitForCycle(node.id, ctx);
    if (cycle) {
      return [{ kind: "cycle", cycle }];
    }
  }
  return [];
}
