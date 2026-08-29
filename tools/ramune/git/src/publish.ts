// canonical publish の単一 authority 経路（設計正本 §6.4）。
//
// canonical worktree への書き込みは、この関数だけが行う。publish は
// 「journal が publish_prepared である」「fence が journal の assignment と
// 完全一致する」「canonical HEAD が canonicalHeadBefore と一致する」の 3 条件と、
// fast-forward 可能性を検査してから --ff-only で行う。いずれかが崩れていたら
// publish せず PublishPreconditionError（型付きエラー）で拒否する — 呼び出し側は
// integration_state_uncertain として記録する判断を行う（§7）。
//
// fence の比較には graph パッケージの sameFence を使う（完全一致の定義の
// 二重管理を避ける）。呼び出し側（サーバ）は「現在の assignment」としてグラフ
// transaction 内で取り出した fence を渡す責務を持つ。この関数は渡された値同士の
// 整合（journal ↔ fence ↔ git の状態）を検査する。
import {
  commitIdSchema,
  sameFence,
  type AssignmentFence,
  type CommitId,
  type IntegrationJournal,
} from "@webapp-blueprint/ramune-graph";

import { runGit, runGitOutcome } from "./git-command.ts";

export type PublishPreconditionViolation =
  | { reason: "journal_not_publish_prepared"; stage: IntegrationJournal["progress"]["stage"] }
  | {
      reason: "fence_mismatch";
      journalAssignmentFence: AssignmentFence;
      providedFence: AssignmentFence;
    }
  | { reason: "canonical_not_clean"; observedState: string }
  | { reason: "canonical_head_moved"; expected: CommitId; actual: CommitId }
  | {
      reason: "not_fast_forward";
      canonicalHeadBefore: CommitId;
      integratedCommit: CommitId;
    }
  | { reason: "post_condition_violation"; expected: CommitId; actual: CommitId };

export class PublishPreconditionError extends Error {
  readonly violation: PublishPreconditionViolation;

  constructor(violation: PublishPreconditionViolation) {
    super(
      `publish の前提条件を満たさないため publish しませんでした: ${JSON.stringify(violation)}`,
    );
    this.name = "PublishPreconditionError";
    this.violation = violation;
  }
}

export interface PublishCandidateInput {
  /** canonical リポジトリのルート。 */
  readonly repositoryRoot: string;
  /** 対象ノードの統合 journal。progress が publish_prepared であることを要求する。 */
  readonly journal: IntegrationJournal;
  /**
   * サーバが「現在の assignment」として取り出した fence。
   * journal.assignment との完全一致をここで機械検査する。
   */
  readonly fence: AssignmentFence;
}

export interface PublishedCandidate {
  readonly publishedCommit: CommitId;
}

async function canonicalWorktreeState(
  repositoryRoot: string,
): Promise<"clean" | "dirty" | "merge_in_progress" | "missing"> {
  const mergeHead = await runGitOutcome(repositoryRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    "MERGE_HEAD",
  ]);
  if (mergeHead.exitCode === 0) {
    return "merge_in_progress";
  }
  const status = await runGit(repositoryRoot, ["status", "--porcelain"]);
  if (status.length > 0) {
    return "dirty";
  }
  return "clean";
}

async function canonicalHead(repositoryRoot: string): Promise<CommitId> {
  const head = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
  return commitIdSchema.parse(head);
}

/** journal 段階と fence の一致（サーバが渡した「現在の assignment」との整合）を検査する。 */
function assertJournalAndFence(journal: IntegrationJournal, fence: AssignmentFence): CommitId {
  if (journal.progress.stage !== "publish_prepared") {
    throw new PublishPreconditionError({
      reason: "journal_not_publish_prepared",
      stage: journal.progress.stage,
    });
  }
  if (!sameFence(journal.assignment, fence)) {
    throw new PublishPreconditionError({
      reason: "fence_mismatch",
      journalAssignmentFence: {
        id: journal.assignment.id,
        nodeId: journal.assignment.nodeId,
        runId: journal.assignment.runId,
        epoch: journal.assignment.epoch,
      },
      providedFence: fence,
    });
  }
  return journal.progress.integratedCommit;
}

/** canonical 側の Git 状態（clean・expected HEAD・fast-forward 可能性）を検査する。 */
async function assertCanonicalReady(
  repositoryRoot: string,
  canonicalHeadBefore: CommitId,
  integratedCommit: CommitId,
): Promise<void> {
  const state = await canonicalWorktreeState(repositoryRoot);
  if (state !== "clean") {
    throw new PublishPreconditionError({ reason: "canonical_not_clean", observedState: state });
  }

  const head = await canonicalHead(repositoryRoot);
  if (head !== canonicalHeadBefore) {
    throw new PublishPreconditionError({
      reason: "canonical_head_moved",
      expected: canonicalHeadBefore,
      actual: head,
    });
  }

  const ancestorOutcome = await runGitOutcome(repositoryRoot, [
    "merge-base",
    "--is-ancestor",
    canonicalHeadBefore,
    integratedCommit,
  ]);
  if (ancestorOutcome.exitCode !== 0) {
    throw new PublishPreconditionError({
      reason: "not_fast_forward",
      canonicalHeadBefore,
      integratedCommit,
    });
  }
}

/**
 * publish_prepared な統合結果を canonical へ fast-forward する。
 * 検査 → 実行 → 事後確認の順に進み、どの時点でも条件が崩れたら publish を
 * 完了させない。
 */
export async function publishCandidate(input: PublishCandidateInput): Promise<PublishedCandidate> {
  const { repositoryRoot, journal, fence } = input;

  const integratedCommit = assertJournalAndFence(journal, fence);
  await assertCanonicalReady(repositoryRoot, journal.canonicalHeadBefore, integratedCommit);

  // --ff-only: HEAD が動いた場合に merge コミットを作らず失敗する。検査と実行の
  // 間に状態が変わった場合も、canonical へ余計なコミットを残さない。
  await runGit(repositoryRoot, ["merge", "--ff-only", integratedCommit]);

  const publishedHead = await canonicalHead(repositoryRoot);
  if (publishedHead !== integratedCommit) {
    throw new PublishPreconditionError({
      reason: "post_condition_violation",
      expected: integratedCommit,
      actual: publishedHead,
    });
  }

  return { publishedCommit: publishedHead };
}
