import {
  assignmentFenceSchema,
  assignmentIdSchema,
  commitIdSchema,
  digestSchema,
  isoDateTimeSchema,
  plannedNodeIdSchema,
  runIdSchema,
  epochSchema,
  workspaceIdSchema,
  type AssignmentFence,
  type CommitId,
  type IntegratorAssignment,
  type IntegrationJournal,
  type SuccessfulCheck,
  type WorkspaceId,
} from "@webapp-blueprint/ramune-graph";

/**
 * publish のテストが使う journal / fence を、graph パッケージの zod スキーマを
 * 通して組み立てる（境界での検証をテストでも本番と同じ経路に保つ）。
 * 値の意味は引数名のとおりであり、スキーマが要求する branded 型への変換は
 * ここでだけ行う。
 */

export function parseWorkspaceId(raw: string): WorkspaceId {
  return workspaceIdSchema.parse(raw);
}

export function parseCommitId(raw: string): CommitId {
  return commitIdSchema.parse(raw);
}

// oxlint-disable-next-line eslint(no-magic-numbers) — git のコミット SHA（SHA-1）は16進40桁と規定されている。
const SHA_HEX_LENGTH = 40;

/** 実在しないコミットの SHA を1桁の16進数字から組み立てる（拒否テストの入力）。 */
export function arbitraryShaHex(hexDigit: string): CommitId {
  return parseCommitId(hexDigit.repeat(SHA_HEX_LENGTH));
}

export interface JournalFixtureInput {
  readonly assignmentId: number;
  readonly nodeId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly workspaceId: string;
  readonly candidateCommit: string;
  readonly canonicalHeadBefore: string;
  readonly integratedCommit?: string;
}

/** IntegratorAssignment（= fence の完全一致元）を組み立てる。 */
export function buildIntegratorAssignment(input: JournalFixtureInput): IntegratorAssignment {
  return {
    id: assignmentIdSchema.parse(input.assignmentId),
    nodeId: plannedNodeIdSchema.parse(input.nodeId),
    runId: runIdSchema.parse(input.runId),
    epoch: epochSchema.parse(input.epoch),
    role: "integrator",
    workspaceId: workspaceIdSchema.parse(input.workspaceId),
    startedAt: isoDateTimeSchema.parse(new Date().toISOString()),
  };
}

export function buildFence(assignment: IntegratorAssignment): AssignmentFence {
  // fenceOf ではなくスキーマで作る（fence 単体で来る経路＝完了系ツール入力と同じ形）。
  return assignmentFenceSchema.parse({
    id: assignment.id,
    nodeId: assignment.nodeId,
    runId: assignment.runId,
    epoch: assignment.epoch,
  });
}

function fixtureSuccessfulCheck(checkedCommit: CommitId): SuccessfulCheck {
  return {
    command: "mise run check",
    checkedCommit,
    exitCode: 0,
    outputDigest: digestSchema.parse("fixture-digest"),
    finishedAt: isoDateTimeSchema.parse(new Date().toISOString()),
  };
}

/**
 * progress を指定した段階の journal を組み立てる。publish テストは
 * "publish_prepared" を使い、「まだ claimed」の拒否テストは "claimed" を使う。
 */
export function buildJournal(
  input: JournalFixtureInput,
  stage: "claimed" | "merge_prepared" | "publish_prepared",
): IntegrationJournal {
  const candidateCommit = parseCommitId(input.candidateCommit);
  const integratedCommit =
    input.integratedCommit === undefined ? candidateCommit : parseCommitId(input.integratedCommit);
  let progress: IntegrationJournal["progress"];
  if (stage === "claimed") {
    progress = { stage: "claimed" };
  } else if (stage === "merge_prepared") {
    progress = { stage: "merge_prepared", integratedCommit };
  } else {
    progress = {
      stage: "publish_prepared",
      integratedCommit,
      verification: fixtureSuccessfulCheck(integratedCommit),
    };
  }
  return {
    assignment: buildIntegratorAssignment(input),
    candidateCommit,
    canonicalHeadBefore: parseCommitId(input.canonicalHeadBefore),
    progress,
  };
}
