import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  epochSchema,
  type AssignmentFence,
  type IntegrationJournal,
} from "@webapp-blueprint/ramune-graph";
import {
  PublishPreconditionError,
  allocateWorkspace,
  prepareIntegrationMerge,
  publishCandidate,
} from "../src/index.ts";
import {
  buildFence,
  buildIntegratorAssignment,
  buildJournal,
  parseCommitId,
  parseWorkspaceId,
} from "./support/journal-fixture.ts";
import { commitFile, createGitRepo, revParseHead, runTestGit } from "./support/fake-git-repo.ts";

// canonical publish の単一経路（設計正本 §6.4）の公開契約。
// 「journal が publish_prepared」「fence が現在の assignment と完全一致」
// 「canonical HEAD が canonicalHeadBefore と一致」の 3 条件 + fast-forward 可能性を
// 検査してから fast-forward し、いずれかが崩れたら publish せず型付きエラーになる。
//
// eslint/max-lines-per-function・max-statements に収めるため、シナリオを組み立てる
// 手順はモジュールスコープのヘルパに置き、describe は正常系と拒否系に分ける。

const FIXTURE_INPUT_BASE = {
  assignmentId: 7,
  nodeId: "task-a",
  runId: "run-1",
  epoch: 0,
  workspaceId: "ws-integration",
} as const;

// oxlint-disable-next-line eslint/no-magic-numbers — resume 済みセッションを模倣するための任意の旧 epoch 値。
const STALE_EPOCH = 9;

interface PublishScenario {
  /** 統合コミットの SHA（fixture の rev-parse 出力。raw のまま比較に使う）。 */
  readonly integratedCommit: string;
  readonly journal: IntegrationJournal;
  readonly fence: AssignmentFence;
}

/** journal(publish_prepared)・fence・統合コミットが揃った正常系の入力を組み立てる。 */
async function seedPublishableScenario(repositoryRoot: string): Promise<PublishScenario> {
  const baseCommit = revParseHead(repositoryRoot);
  const integration = await allocateWorkspace({
    repositoryRoot,
    workspaceId: parseWorkspaceId("ws-integration"),
    baseCommit: parseCommitId(baseCommit),
  });
  const worker = await allocateWorkspace({
    repositoryRoot,
    workspaceId: parseWorkspaceId("ws-worker"),
    baseCommit: parseCommitId(baseCommit),
  });
  const candidateCommit = await commitFile(worker.path, {
    relativePath: "feature.txt",
    content: "worker output\n",
    message: "worker change",
  });
  const { integratedCommit } = await prepareIntegrationMerge({
    integrationWorktreePath: integration.path,
    candidateCommit: parseCommitId(candidateCommit),
  });

  const fixtureInput = {
    ...FIXTURE_INPUT_BASE,
    candidateCommit,
    canonicalHeadBefore: baseCommit,
    integratedCommit,
  };
  return {
    integratedCommit,
    journal: buildJournal(fixtureInput, "publish_prepared"),
    fence: buildFence(buildIntegratorAssignment(fixtureInput)),
  };
}

async function createIsolatedRepo(): Promise<string> {
  return await createGitRepo(fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-publish-test-")));
}

describe(publishCandidate, () => {
  it("3 条件が揃っていれば canonical を fast-forward し、作業ツリーも更新する", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const scenario = await seedPublishableScenario(repositoryRoot);

    const { publishedCommit } = await publishCandidate({
      repositoryRoot,
      journal: scenario.journal,
      fence: scenario.fence,
    });

    expect(publishedCommit).toBe(scenario.integratedCommit);
    expect(revParseHead(repositoryRoot)).toBe(scenario.integratedCommit);
    // canonical の作業ツリーに candidate の変更が現れている。
    expect(fs.readFileSync(path.join(repositoryRoot, "feature.txt"), "utf-8")).toBe(
      "worker output\n",
    );
    expect(runTestGit(repositoryRoot, ["status", "--porcelain"])).toBe("");
  });
});

describe("publishCandidate: journal 段階と fence の検査", () => {
  it("journal が publish_prepared でなければ publish せず拒否する", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const scenario = await seedPublishableScenario(repositoryRoot);
    const claimed = buildJournal(
      {
        ...FIXTURE_INPUT_BASE,
        candidateCommit: scenario.journal.candidateCommit,
        canonicalHeadBefore: scenario.journal.canonicalHeadBefore,
        integratedCommit: scenario.integratedCommit,
      },
      "claimed",
    );

    await expect(
      publishCandidate({ repositoryRoot, journal: claimed, fence: scenario.fence }),
    ).rejects.toThrow(PublishPreconditionError);
    expect(revParseHead(repositoryRoot)).not.toBe(scenario.integratedCommit);
  });

  it("fence が journal の assignment と一致しなければ publish せず拒否する", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const scenario = await seedPublishableScenario(repositoryRoot);
    // 旧 epoch の stale fence（resume 済みセッションからの書き込みを模倣）。
    const staleFence = { ...scenario.fence, epoch: epochSchema.parse(STALE_EPOCH) };

    await expect(
      publishCandidate({ repositoryRoot, journal: scenario.journal, fence: staleFence }),
    ).rejects.toThrow(PublishPreconditionError);
    expect(revParseHead(repositoryRoot)).not.toBe(scenario.integratedCommit);
  });
});

describe("publishCandidate: canonical HEAD の検査", () => {
  it("canonical HEAD が canonicalHeadBefore から動いていれば publish せず拒否する", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const scenario = await seedPublishableScenario(repositoryRoot);
    // journal 作成後に canonical が別の変更で進んだ状態を再現する。
    await commitFile(repositoryRoot, {
      relativePath: "unrelated.txt",
      content: "moved on\n",
      message: "advance canonical",
    });

    await expect(
      publishCandidate({ repositoryRoot, journal: scenario.journal, fence: scenario.fence }),
    ).rejects.toThrow(PublishPreconditionError);
    expect(revParseHead(repositoryRoot)).not.toBe(scenario.integratedCommit);
  });
});

describe("publishCandidate: fast-forward 可能性の検査", () => {
  /** 別履歴（無関係なルート）のコミットを統合結果に偽装した journal を組み立てる。 */
  async function seedOrphanScenario(repositoryRoot: string): Promise<{
    readonly journal: IntegrationJournal;
    readonly fence: AssignmentFence;
    readonly orphanCommit: string;
  }> {
    // 初期ツリーの内容を変えて root SHA を canonical と確実に違え、ローカル fetch
    // でオブジェクトだけを持ち込むため、canonical 側のブランチは一切動かさない。
    const scenario = await seedPublishableScenario(repositoryRoot);
    const unrelatedParent = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-publish-unrelated-"));
    const unrelatedRepo = await createGitRepo(unrelatedParent, {
      readmeContent: "# unrelated history\n",
    });
    const orphanCommit = await commitFile(unrelatedRepo, {
      relativePath: "orphan.txt",
      content: "orphan\n",
      message: "orphan root",
    });
    runTestGit(repositoryRoot, ["fetch", unrelatedRepo]);
    const journal = buildJournal(
      {
        ...FIXTURE_INPUT_BASE,
        candidateCommit: scenario.journal.candidateCommit,
        canonicalHeadBefore: scenario.journal.canonicalHeadBefore,
        integratedCommit: orphanCommit,
      },
      "publish_prepared",
    );
    return { journal, fence: scenario.fence, orphanCommit };
  }

  it("integratedCommit が canonicalHeadBefore の子孫でなければ publish せず拒否する", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const { journal, fence, orphanCommit } = await seedOrphanScenario(repositoryRoot);

    await expect(publishCandidate({ repositoryRoot, journal, fence })).rejects.toThrow(
      PublishPreconditionError,
    );
    expect(revParseHead(repositoryRoot)).not.toBe(orphanCommit);
  });
});
