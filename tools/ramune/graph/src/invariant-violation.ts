// 不変条件違反の型。invariants.ts / cycle-detection.ts の両方から参照するため、
// どちらか一方のファイルに置くと片方が他方に依存する形になってしまう。
// 型だけを独立したファイルに切り出すことで、検査ロジックのファイル分割
// （原則7「拡張はファイルの追加で表現される」）と両立させる。
//
// 違反の種類は設計正本 §2.8「型で表現できない invariant」の各項に対応する。

export type InvariantViolation =
  | { readonly kind: "duplicate_node_id"; readonly id: string }
  | { readonly kind: "dangling_dependency"; readonly nodeId: string; readonly missingDepId: string }
  | { readonly kind: "duplicate_dependency"; readonly nodeId: string; readonly depId: string }
  | { readonly kind: "self_dependency"; readonly nodeId: string }
  | { readonly kind: "cycle"; readonly cycle: readonly string[] }
  | {
      readonly kind: "missing_boundary_node";
      readonly boundary: "start" | "end";
    }
  | {
      readonly kind: "boundary_mutated";
      readonly boundary: "start" | "end";
      readonly detail: string;
    }
  /** task ノードが end に依存している（end はシンクでなければならない。§2.7）。 */
  | { readonly kind: "end_dependency"; readonly nodeId: string }
  | {
      readonly kind: "unsafe_number";
      readonly field: string;
      readonly value: number;
      readonly detail: string;
    }
  | {
      readonly kind: "allocator_behind_issued";
      readonly nextAllocationId: number;
      readonly maxIssuedId: number;
    }
  | {
      readonly kind: "fence_session_mismatch";
      readonly nodeId: string;
      readonly detail: string;
    }
  | { readonly kind: "multiple_integrating"; readonly nodeIds: readonly string[] }
  | {
      readonly kind: "candidate_source_node_mismatch";
      readonly nodeId: string;
      readonly sourceNodeId: string;
    }
  | { readonly kind: "cross_reference_broken"; readonly detail: string };
