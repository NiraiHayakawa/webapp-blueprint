// 統合 journal と Git 観測（設計正本 §2.4）。
//
// canonical への merge と graph 更新は原子的にできないため、統合の進行段階を
// journal としてグラフに永続化し、crash 後の照合（§7）を可能にする。
import { z } from "zod";

import { commitIdSchema, digestSchema, isoDateTimeSchema, nonZeroExitCodeSchema } from "./brand.ts";
import type { CommitId, Digest, IsoDateTime, NonZeroExitCode } from "./brand.ts";
import { integratorAssignmentSchema } from "./assignment.ts";
import type { IntegratorAssignment } from "./assignment.ts";

const checkCommon = {
  command: z.literal("mise run check"),
  checkedCommit: commitIdSchema,
  outputDigest: digestSchema,
  finishedAt: isoDateTimeSchema,
} as const;

/** 1 コマンド検証（絶対規約 8）が成功したことの証跡。 */
export interface SuccessfulCheck {
  readonly command: "mise run check";
  readonly checkedCommit: CommitId;
  readonly exitCode: 0;
  readonly outputDigest: Digest;
  readonly finishedAt: IsoDateTime;
}

export const successfulCheckSchema = z.strictObject({
  ...checkCommon,
  exitCode: z.literal(0),
});

export interface FailedCheck {
  readonly command: "mise run check";
  readonly checkedCommit: CommitId;
  readonly exitCode: NonZeroExitCode;
  readonly outputDigest: Digest;
  readonly finishedAt: IsoDateTime;
}

export const failedCheckSchema = z.strictObject({
  ...checkCommon,
  exitCode: nonZeroExitCodeSchema,
});

/**
 * 統合の進行段階。publish_prepared は canonical への CAS の前に必ず永続化する
 * （crash 後は canonical HEAD と照合する）。
 */
export type IntegrationProgress =
  | { readonly stage: "claimed" }
  | { readonly stage: "merge_prepared"; readonly integratedCommit: CommitId }
  | {
      readonly stage: "publish_prepared";
      readonly integratedCommit: CommitId;
      readonly verification: SuccessfulCheck;
    };

const integrationProgressSchema = z.union([
  z.strictObject({ stage: z.literal("claimed") }),
  z.strictObject({ stage: z.literal("merge_prepared"), integratedCommit: commitIdSchema }),
  z.strictObject({
    stage: z.literal("publish_prepared"),
    integratedCommit: commitIdSchema,
    verification: successfulCheckSchema,
  }),
]);

export interface IntegrationJournal {
  readonly assignment: IntegratorAssignment;
  readonly candidateCommit: CommitId;
  readonly canonicalHeadBefore: CommitId;
  readonly progress: IntegrationProgress;
}

export const integrationJournalSchema = z.strictObject({
  assignment: integratorAssignmentSchema,
  candidateCommit: commitIdSchema,
  canonicalHeadBefore: commitIdSchema,
  progress: integrationProgressSchema,
});

/** abandon 照合（§7）の入力となる Git 観測。観測者は Integrator / Orchestrator。 */
export interface GitObservation {
  readonly canonicalHead: CommitId;
  readonly canonicalWorktree: "clean" | "dirty" | "merge_in_progress" | "missing";
  readonly integrationWorkspace: "clean" | "dirty" | "merge_in_progress" | "missing";
}

export const gitObservationSchema = z.strictObject({
  canonicalHead: commitIdSchema,
  canonicalWorktree: z.enum(["clean", "dirty", "merge_in_progress", "missing"]),
  integrationWorkspace: z.enum(["clean", "dirty", "merge_in_progress", "missing"]),
});
