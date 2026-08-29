// グラフ不変条件の検査（設計正本 §2.8）。
//
// 検査は常に「適用後のグラフ状態」に対して行う（transaction.ts が呼び出す）。ここでは
// 検査だけを行い、修正や例外送出は行わない。違反を1件も見逃さず列挙し、判断
// （拒否するかどうか）は呼び出し側に委ねる。
//
// 対象の invariant（§2.8 の一覧。v1 の到達可能性検査は §2.8 に無いため持たない）:
//   1. 数値は非負の safe integer。revision / allocator の overflow は fail-closed
//      （加算時点の検査は transaction.ts。ここでは保存された値の形を検査する）
//   2. nextAllocationId は保存済みの全 allocation ID より大きい
//   3. node ID は一意。deps は実在し、重複・自己参照・サイクルがない
//   4. active な assignment の fence は graph の session.runId / epoch と完全一致
//   5. graph 全体で integrating は高々 1 件（§6.4）
//   6. Candidate.source は submit 時の current assignment と完全一致
//      （グラフ層で検査できるのは「source.nodeId === ノード自身の id」まで。
//      commit が baseCommit の子孫であることの検査は Git 観測が必要であり、
//      submit を受け付けるサーバ側（WP3 / WP6）の責務として残す）
//   7. C と R の相互参照（resolutionNodeId ↔ resolves）は 1 対 1
//
// 各検査の実体は invariants/ 配下に分かれている（1 検査 = 1 ファイル。codopsy の
// 複雑度ゲートと原則7「拡張はファイル追加で表現される」の受け皿）。このファイルは
// 集約のみを行う。
import type { GraphV2 } from "./graph.ts";
import type { InvariantViolation } from "./invariant-violation.ts";
import { findUnsafeNumbers } from "./invariants/unsafe-numbers.ts";
import { findAllocatorViolations } from "./invariants/allocation-ledger.ts";
import {
  findBoundaryViolations,
  findDependencyViolations,
  findDuplicateNodeIds,
} from "./invariants/structure.ts";
import { findFenceSessionViolations } from "./invariants/fence-session.ts";
import {
  findCandidateSourceViolations,
  findIntegratingViolations,
} from "./invariants/integration-state.ts";
import { findCrossReferenceViolations } from "./invariants/cross-reference.ts";

export type { InvariantViolation } from "./invariant-violation.ts";

export function findInvariantViolations(graph: GraphV2): readonly InvariantViolation[] {
  return [
    ...findUnsafeNumbers(graph),
    ...findAllocatorViolations(graph),
    ...findDuplicateNodeIds(graph),
    ...findBoundaryViolations(graph),
    ...findDependencyViolations(graph),
    ...findFenceSessionViolations(graph),
    ...findIntegratingViolations(graph),
    ...findCandidateSourceViolations(graph),
    ...findCrossReferenceViolations(graph),
  ];
}
