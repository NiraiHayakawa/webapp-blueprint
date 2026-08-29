import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateWorkspace,
  CanonicalNotCleanError,
  captureCanonicalAfterCleanup,
  CleanupIncompleteError,
  cleanupFailedIntegration,
  observeGit,
  prepareIntegrationMerge,
} from "../src/index.ts";
import { parseCommitId, parseWorkspaceId } from "./support/journal-fixture.ts";
import { commitFile, createGitRepo, revParseHead, runTestGit } from "./support/fake-git-repo.ts";

// 失敗経路の cleanup（設計正本 §6.2「いずれの失敗経路でも、Integrator は canonical
// と統合用 worktree を clean に戻してから記録する」）と、cleanup 証跡
// （canonicalAfterCleanup）の生成の公開契約。
//
// eslint/max-lines-per-function に収めるため、conflict 状態を作る手順は
// モジュールスコープのヘルパに切り出し、describe は兄弟に分けている。

/** conflict 状態まで進めた統合用 worktree のパスを返す。 */
async function seedConflict(repositoryRoot: string): Promise<string> {
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
  // 同一ファイルを統合側と candidate 側の両方で変更して conflict を再現する。
  await commitFile(integration.path, {
    relativePath: "shared.txt",
    content: "integration side\n",
    message: "edit in integration",
  });
  const workerCommit = parseCommitId(
    await commitFile(worker.path, {
      relativePath: "shared.txt",
      content: "worker side\n",
      message: "edit in worker",
    }),
  );
  try {
    await prepareIntegrationMerge({
      integrationWorktreePath: integration.path,
      candidateCommit: workerCommit,
    });
  } catch {
    // conflict を起こすこと自体が目的。ここでは観測しない。
  }
  return integration.path;
}

async function createIsolatedRepo(): Promise<string> {
  return await createGitRepo(fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-cleanup-test-")));
}

describe(cleanupFailedIntegration, () => {
  it("conflict 後に index / MERGE_HEAD / 作業ツリーを復元し、clean 判定になる", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const integrationPath = await seedConflict(repositoryRoot);

    await expect(
      cleanupFailedIntegration({ integrationWorktreePath: integrationPath }),
    ).resolves.toBeUndefined();

    const observation = await observeGit({
      repositoryRoot,
      integrationWorktreePath: integrationPath,
    });
    expect(observation.integrationWorkspace).toBe("clean");
    // 作業ツリーの内容も pre-merge に戻っている。
    expect(fs.readFileSync(path.join(integrationPath, "shared.txt"), "utf-8")).toBe(
      "integration side\n",
    );
  });

  it("merge 中でない clean な worktree の cleanup は何も壊さず成功する", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const baseCommit = parseCommitId(revParseHead(repositoryRoot));
    const integration = await allocateWorkspace({
      repositoryRoot,
      workspaceId: parseWorkspaceId("ws-integration"),
      baseCommit,
    });

    await expect(
      cleanupFailedIntegration({ integrationWorktreePath: integration.path }),
    ).resolves.toBeUndefined();
  });

  it("存在しない worktree の cleanup は型付きエラーで拒否する（clean 証明ができないため）", async () => {
    expect.hasAssertions();
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-cleanup-test-"));
    await expect(
      cleanupFailedIntegration({ integrationWorktreePath: path.join(parentDir, "missing-ws") }),
    ).rejects.toThrow(CleanupIncompleteError);
  });
});

describe(captureCanonicalAfterCleanup, () => {
  it("canonical が clean なら head + clean の証跡を返す", async () => {
    expect.hasAssertions();
    const repositoryRoot = await createIsolatedRepo();
    const head = parseCommitId(revParseHead(repositoryRoot));
    await expect(captureCanonicalAfterCleanup({ repositoryRoot })).resolves.toStrictEqual({
      head,
      worktree: "clean",
    });
  });

  it("canonical が dirty なら型付きエラーで拒否する（cleanup 義務の未遂を証跡にできない）", async () => {
    expect.hasAssertions();
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-cleanup-test-"));
    const repositoryRoot = await createGitRepo(parentDir);
    fs.writeFileSync(path.join(repositoryRoot, "README.md"), "dirty\n", "utf-8");
    await expect(captureCanonicalAfterCleanup({ repositoryRoot })).rejects.toThrow(
      CanonicalNotCleanError,
    );
  });

  it("canonical が merge 中なら型付きエラーで拒否する", async () => {
    expect.hasAssertions();
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-cleanup-test-"));
    const repositoryRoot = await createGitRepo(parentDir);
    // canonical 側で実際に conflict する merge を開始し、MERGE_HEAD を残す。
    runTestGit(repositoryRoot, ["checkout", "-b", "side"]);
    await commitFile(repositoryRoot, {
      relativePath: "README.md",
      content: "side\n",
      message: "side edit",
    });
    runTestGit(repositoryRoot, ["checkout", "main"]);
    await commitFile(repositoryRoot, {
      relativePath: "README.md",
      content: "main\n",
      message: "main edit",
    });
    try {
      runTestGit(repositoryRoot, ["merge", "--no-edit", "side"]);
    } catch {
      // コンフリクトさせて MERGE_HEAD を残すのが目的。
    }
    await expect(captureCanonicalAfterCleanup({ repositoryRoot })).rejects.toThrow(
      CanonicalNotCleanError,
    );
  });
});
