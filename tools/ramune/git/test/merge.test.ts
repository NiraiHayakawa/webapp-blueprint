import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  IntegrationWorkspaceNotCleanError,
  MergeConflictError,
  UnknownCandidateCommitError,
  allocateWorkspace,
  observeGit,
  prepareIntegrationMerge,
} from "../src/index.ts";
import { arbitraryShaHex, parseCommitId, parseWorkspaceId } from "./support/journal-fixture.ts";
import { commitFile, createGitRepo, revParseHead } from "./support/fake-git-repo.ts";

// 統合用 worktree での merge（設計正本 §6.2 step 2）の公開契約。
// conflict の再現は「同一ファイルを統合側と candidate 側の両方で変更」で行う。
//
// eslint/max-lines-per-function・max-statements に収めるため、worktree を用意する
// 手順と「投げられた値をそのまま観測する」ヘルパはモジュールスコープに置き、
// describe は兄弟に分けている。

interface ScenarioWorkspaces {
  readonly integrationPath: string;
  readonly workerPath: string;
}

/** 統合 worktree（canonical HEAD 起点）と candidate を作る Worker worktree を用意する。 */
async function seedWorkspaces(repositoryRoot: string): Promise<ScenarioWorkspaces> {
  const baseCommit = parseCommitId(revParseHead(repositoryRoot));
  const integration = await allocateWorkspace({
    repositoryRoot,
    workspaceId: parseWorkspaceId("ws-integration"),
    baseCommit,
  });
  const worker = await allocateWorkspace({
    repositoryRoot,
    workspaceId: parseWorkspaceId("ws-worker"),
    baseCommit,
  });
  return { integrationPath: integration.path, workerPath: worker.path };
}

async function createIsolatedRepo(): Promise<string> {
  return await createGitRepo(fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-merge-test-")));
}

/** promise の結果（成功値または投げられた値）をそのまま返す。 */
async function caughtOf(promise: Promise<unknown>): Promise<Error | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new TypeError("Error 以外の値が投げられた（契約違反）", { cause: error });
  }
}

/** 統合側と candidate 側で同じファイルを別内容に変更した状態を作る。 */
async function seedConflictInputs(repositoryRoot: string): Promise<{
  readonly integrationPath: string;
  readonly candidateCommit: ReturnType<typeof parseCommitId>;
}> {
  const { integrationPath, workerPath } = await seedWorkspaces(repositoryRoot);
  await commitFile(integrationPath, {
    relativePath: "shared.txt",
    content: "integration side\n",
    message: "edit in integration",
  });
  const candidateCommit = parseCommitId(
    await commitFile(workerPath, {
      relativePath: "shared.txt",
      content: "worker side\n",
      message: "edit in worker",
    }),
  );
  return { integrationPath, candidateCommit };
}

describe(prepareIntegrationMerge, () => {
  it("candidate を merge し、--no-ff の統合コミットを integratedCommit として返す", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const { integrationPath, workerPath } = await seedWorkspaces(repositoryRoot);
    const candidateCommit = parseCommitId(
      await commitFile(workerPath, {
        relativePath: "feature.txt",
        content: "worker output\n",
        message: "worker change",
      }),
    );

    const { integratedCommit } = await prepareIntegrationMerge({
      integrationWorktreePath: integrationPath,
      candidateCommit,
    });

    // --no-ff なので candidate 単体ではなく統合コミットが生まれる。
    expect(integratedCommit).not.toBe(candidateCommit);
    expect(fs.existsSync(path.join(integrationPath, "feature.txt"))).toBe(true);
  });

  it("merge 後の統合用 worktree は clean として観測される", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const { integrationPath, workerPath } = await seedWorkspaces(repositoryRoot);
    const candidateCommit = parseCommitId(
      await commitFile(workerPath, {
        relativePath: "feature.txt",
        content: "worker output\n",
        message: "worker change",
      }),
    );

    await prepareIntegrationMerge({ integrationWorktreePath: integrationPath, candidateCommit });

    const observation = await observeGit({
      repositoryRoot,
      integrationWorktreePath: integrationPath,
    });
    expect(observation.integrationWorkspace).toBe("clean");
  });
});

describe("prepareIntegrationMerge: 同一ファイルの両側変更は MergeConflictError になる", () => {
  it("MergeConflictError が競合ファイル一覧を報告する", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const { integrationPath, candidateCommit } = await seedConflictInputs(repositoryRoot);

    const caught = await caughtOf(
      prepareIntegrationMerge({ integrationWorktreePath: integrationPath, candidateCommit }),
    );
    if (!(caught instanceof MergeConflictError)) {
      throw new Error(`MergeConflictError 以外が投げられた: ${String(caught)}`);
    }
    expect(caught.conflictedFiles).toContain("shared.txt");
  });

  it("conflict 後の worktree は merge_in_progress として観測される（cleanup / abandon 照合の入力）", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const { integrationPath, candidateCommit } = await seedConflictInputs(repositoryRoot);

    const caught = await caughtOf(
      prepareIntegrationMerge({ integrationWorktreePath: integrationPath, candidateCommit }),
    );
    if (!(caught instanceof MergeConflictError)) {
      throw new Error(`MergeConflictError 以外が投げられた: ${String(caught)}`);
    }

    const observation = await observeGit({
      repositoryRoot,
      integrationWorktreePath: integrationPath,
    });
    expect(observation.integrationWorkspace).toBe("merge_in_progress");
  });
});

describe("prepareIntegrationMerge: 前提条件を満たさない入力は型付きエラーで拒否する", () => {
  it("dirty な統合 worktree での merge は拒否する", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const { integrationPath, workerPath } = await seedWorkspaces(repositoryRoot);
    fs.writeFileSync(path.join(integrationPath, "README.md"), "uncommitted\n", "utf-8");
    const candidateCommit = parseCommitId(revParseHead(workerPath));

    await expect(
      prepareIntegrationMerge({ integrationWorktreePath: integrationPath, candidateCommit }),
    ).rejects.toThrow(IntegrationWorkspaceNotCleanError);
  });

  it("存在しない candidate commit は型付きエラーで拒否する", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const { integrationPath } = await seedWorkspaces(repositoryRoot);

    await expect(
      prepareIntegrationMerge({
        integrationWorktreePath: integrationPath,
        candidateCommit: arbitraryShaHex("1"),
      }),
    ).rejects.toThrow(UnknownCandidateCommitError);
  });
});
