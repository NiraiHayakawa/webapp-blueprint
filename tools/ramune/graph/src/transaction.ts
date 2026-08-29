// graph transaction の共通機構（設計正本 §4 のグラフ層側の半分）。
//
// 各差分操作は「遷移 → 不変条件検査 → revision +1」を finalizeTransaction で
// 閉じる。永続化・直列化（async mutex）は store 側（WP2）の責務であり、ここでは
// 「1 操作 = 1 transaction = revision +1」という規約だけを提供する。
//
// allocator（nextAllocationId）の発番は allocateId で行う。発番ごとに +1 し、
// wraparound / 枯渇は fail-closed で拒否する（§2.8）。自動リトライ・再利用は
// 作らない。
import type { Revision } from "./brand.ts";
import { allocationIdSchema, revisionSchema } from "./brand.ts";
import { findInvariantViolations } from "./invariants.ts";
import type { InvariantViolation } from "./invariant-violation.ts";
import type { GraphV2 } from "./graph.ts";
import { throwAllocationExhaustedError } from "./allocation-exhausted-error.ts";
import { throwRevisionOverflowError } from "./revision-overflow-error.ts";

export { AllocationExhaustedError } from "./allocation-exhausted-error.ts";
export { RevisionOverflowError } from "./revision-overflow-error.ts";

export class GraphInvariantViolationError extends Error {
  readonly violations: readonly InvariantViolation[];

  constructor(violations: readonly InvariantViolation[]) {
    super(`グラフの不変条件に違反する適用結果になるため拒否した: ${JSON.stringify(violations)}`);
    this.name = "GraphInvariantViolationError";
    this.violations = violations;
  }
}

/**
 * allocator から次の ID を発番する。戻り値の graph には「発番後の nextAllocationId」
 * が入っているため、呼び出し側は以降の構築をその graph ベースで続ける。
 */
export function allocateId(graph: GraphV2) {
  const id = graph.nextAllocationId;
  if (!Number.isSafeInteger(id + 1)) {
    throwAllocationExhaustedError(id);
  }
  return {
    id: allocationIdSchema.parse(id),
    graph: { ...graph, nextAllocationId: allocationIdSchema.parse(id + 1) },
  };
}

/** この transaction の結果として刻む revision（現在値 +1）。overflow は fail-closed。 */
export function nextRevision(graph: GraphV2): Revision {
  const value = graph.revision + 1;
  if (!Number.isSafeInteger(value)) {
    throwRevisionOverflowError(graph.revision);
  }
  return revisionSchema.parse(value);
}

/**
 * 遷移後のグラフに対して不変条件を検査し、revision を +1 して確定する。
 * 違反があれば投げて捨てるため、呼び出し側が持つグラフは常に適用前か
 * 検査済み適用後のどちらかであり、中間状態が外部から観測されることはない。
 */
export function finalizeTransaction(graph: GraphV2): GraphV2 {
  const violations = findInvariantViolations(graph);
  if (violations.length > 0) {
    throw new GraphInvariantViolationError(violations);
  }
  return { ...graph, revision: nextRevision(graph) };
}
