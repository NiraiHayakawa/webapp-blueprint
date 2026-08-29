// ツール入力（MCP の JSON。snake_case）とドメイン層の branded 型の変換。
//
// 変換はすべて graph パッケージが公開する zod スキーマを通す。スキーマの検証に
// 通った値だけが branded 型としてドメイン操作に渡るため、「ツール入力の JSON が
// ドメイン契約を満たすこと」をこの1箇所で機械的に保証する。各ツールが独自に
// キャストを書く形にすると、検査漏れがツール数だけ散らかる。
import {
  assignmentIdSchema,
  commitIdSchema,
  digestSchema,
  epochSchema,
  isoDateTimeSchema,
  jsonValueSchema,
  nonEmptyStringSchema,
  nonZeroExitCodeSchema,
  repoPathSchema,
  runIdSchema,
  taskIdSchema,
  type AssignmentFence,
  type CommitId,
  type Digest,
  type FailedCheck,
  type GitObservation,
  type IsoDateTime,
  type NonEmptyString,
  type RepoPath,
  type WorkReport,
} from "@webapp-blueprint/ramune-graph";

/** ワイヤ形式の fence（ramune_claim_ready 以外の完了系・統合系ツールが提示する）。 */
export interface FenceInput {
  readonly id: number;
  readonly node_id: string;
  readonly run_id: string;
  readonly epoch: number;
}

export function toDomainFence(input: FenceInput): AssignmentFence {
  return {
    id: assignmentIdSchema.parse(input.id),
    nodeId: taskIdSchema.parse(input.node_id),
    runId: runIdSchema.parse(input.run_id),
    epoch: epochSchema.parse(input.epoch),
  };
}

export interface ReportInput {
  readonly summary: string;
  readonly data: unknown;
}

export function toDomainReport(input: ReportInput): WorkReport {
  return {
    summary: nonEmptyStringSchema.parse(input.summary),
    data: jsonValueSchema.parse(input.data),
  } satisfies WorkReport;
}

export function toDomainCommit(value: string): CommitId {
  return commitIdSchema.parse(value);
}

export function toDomainDigest(value: string): Digest {
  return digestSchema.parse(value);
}

export function toDomainRepoPaths(values: readonly string[]): readonly RepoPath[] {
  return values.map((value) => repoPathSchema.parse(value));
}

export interface GitObservationInput {
  readonly canonical_head: string;
  readonly canonical_worktree: "clean" | "dirty" | "merge_in_progress" | "missing";
  readonly integration_workspace: "clean" | "dirty" | "merge_in_progress" | "missing";
}

export function toDomainGitObservation(input: GitObservationInput): GitObservation {
  return {
    canonicalHead: commitIdSchema.parse(input.canonical_head),
    canonicalWorktree: input.canonical_worktree,
    integrationWorkspace: input.integration_workspace,
  };
}

/** 統合の 1 コマンド検証（mise run check）が失敗したことの証跡（ワイヤ形式）。 */
export interface FailedCheckInput {
  readonly checked_commit: string;
  readonly exit_code: number;
  readonly output_digest: string;
  readonly finished_at: string;
}

export function toDomainFailedCheck(input: FailedCheckInput): FailedCheck {
  return {
    command: "mise run check",
    checkedCommit: commitIdSchema.parse(input.checked_commit),
    exitCode: nonZeroExitCodeSchema.parse(input.exit_code),
    outputDigest: digestSchema.parse(input.output_digest),
    finishedAt: isoDateTimeSchema.parse(input.finished_at),
  };
}

export function toDomainNonEmptyString(value: string): NonEmptyString {
  return nonEmptyStringSchema.parse(value);
}

/** サーバーが現在時刻を mint する（assignment.startedAt 等の診断情報）。 */
export function nowIso(): IsoDateTime {
  return isoDateTimeSchema.parse(new Date().toISOString());
}
