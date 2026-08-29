import {
  AbandonAssignmentPreconditionError,
  AbortPreconditionError,
  AdvanceIntegrationPreconditionError,
  AllocationExhaustedError,
  ClaimIntegrationPreconditionError,
  ClaimReadyPreconditionError,
  EndSessionPreconditionError,
  EpochOverflowError,
  GraphInvariantViolationError,
  InsertNodePreconditionError,
  InvalidReadyLimitError,
  RecordIntegrationOutcomePreconditionError,
  RecordResultPreconditionError,
  ReopenPreconditionError,
  RequestReplanPreconditionError,
  ResumeSessionPreconditionError,
  StartSessionPreconditionError,
  SubmitCandidatePreconditionError,
} from "@webapp-blueprint/ramune-graph";
import { GraphArchiveTargetExistsError } from "./graph-archive-target-exists-error.ts";
import { GraphHasActiveNodesError } from "./graph-has-active-nodes-error.ts";
import { RevisionConflictError } from "./revision-conflict-error.ts";
import {
  GraphFileCorruptedError,
  GraphNotInitializedError,
  UnsupportedGraphVersionError,
} from "./store.ts";

/**
 * ドメインの前提条件違反・不変条件違反・fence / revision の不一致は「入力の形は
 * 正しいが、ドメインの状態として拒否される」ケースであり、JSON Schema 検証の失敗
 * （形が壊れている = ProtocolError(InvalidParams)）とは種類が異なる。ツール実行結果と
 * して isError: true で返す。呼び出し側（Orchestrator / Planner / Worker /
 * Integrator）が違反の内容を読んで次の一手を判断できる形にするためであり、
 * 握り潰しも自動リトライもしない（§7。docs/principles/fail-fast.md）。
 */
export type DomainRejection =
  // graph パッケージの前提条件エラー
  | AbortPreconditionError
  | AdvanceIntegrationPreconditionError
  | ClaimIntegrationPreconditionError
  | ClaimReadyPreconditionError
  | EndSessionPreconditionError
  | InsertNodePreconditionError
  | RecordIntegrationOutcomePreconditionError
  | RecordResultPreconditionError
  | ReopenPreconditionError
  | RequestReplanPreconditionError
  | ResumeSessionPreconditionError
  | StartSessionPreconditionError
  | SubmitCandidatePreconditionError
  | AbandonAssignmentPreconditionError
  // graph パッケージの状態機械レベルの失敗
  | AllocationExhaustedError
  | EpochOverflowError
  | GraphInvariantViolationError
  | InvalidReadyLimitError
  // store（WP2）の失敗
  | GraphNotInitializedError
  | GraphFileCorruptedError
  | UnsupportedGraphVersionError
  | RevisionConflictError
  | GraphArchiveTargetExistsError
  // ツール層の gate
  | GraphHasActiveNodesError;

/**
 * DomainRejection の構成要素の型。新しいドメインエラーはこの配列（と DomainRejection
 * union）に追加する。isDomainRejection の複雑度を一定に保つためのレジストリである。
 */
const DOMAIN_REJECTION_CONSTRUCTORS: readonly (new (...args: never[]) => Error)[] = [
  AbortPreconditionError,
  AdvanceIntegrationPreconditionError,
  ClaimIntegrationPreconditionError,
  ClaimReadyPreconditionError,
  EndSessionPreconditionError,
  InsertNodePreconditionError,
  RecordIntegrationOutcomePreconditionError,
  RecordResultPreconditionError,
  ReopenPreconditionError,
  RequestReplanPreconditionError,
  ResumeSessionPreconditionError,
  StartSessionPreconditionError,
  SubmitCandidatePreconditionError,
  AbandonAssignmentPreconditionError,
  // graph パッケージの状態機械レベルの失敗
  AllocationExhaustedError,
  EpochOverflowError,
  GraphInvariantViolationError,
  InvalidReadyLimitError,
  // store（WP2）の失敗
  GraphNotInitializedError,
  GraphFileCorruptedError,
  UnsupportedGraphVersionError,
  RevisionConflictError,
  GraphArchiveTargetExistsError,
  // ツール層の gate
  GraphHasActiveNodesError,
];

export function isDomainRejection(error: Error): error is DomainRejection {
  return DOMAIN_REJECTION_CONSTRUCTORS.some((ctor) => error instanceof ctor);
}
