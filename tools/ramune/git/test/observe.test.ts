import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitObservationError, allocateWorkspace, observeGit } from "../src/index.ts";
import type { GitObservation } from "@webapp-blueprint/ramune-graph";
import { parseCommitId, parseWorkspaceId } from "./support/journal-fixture.ts";
import { commitFile, createGitRepo, revParseHead, runTestGit } from "./support/fake-git-repo.ts";

// GitObservation の採取（設計正本 §2.4 / §7 abandon 照合の入力）の公開契約。
// canonical と統合 workspace の状態を clean / dirty / merge_in_progress / missing
// の 4 値で報告できなければならない。
//
// eslint/max-lines-per-function・max-statements に収めるため、describe は
// 観測する状態ごとの兄弟に分けている。

async function createIsolatedRepo(): Promise<{ parentDir: string; repositoryRoot: string }> {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-observe-test-"));
  return { parentDir, repositoryRoot: await createGitRepo(parentDir) };
}

/** 統合用 worktree を割り当て、その中で conflict する merge を開始して残す。 */
async function seedMergeInProgress(repositoryRoot: string): Promise<string> {
  const baseCommit = parseCommitId(revParseHead(repositoryRoot));
  const integration = await allocateWorkspace({
    repositoryRoot,
    workspaceId: parseWorkspaceId("ws-integration"),
    baseCommit,
  });
  await commitFile(integration.path, {
    relativePath: "shared.txt",
    content: "worktree side\n",
    message: "worktree side",
  });
  runTestGit(repositoryRoot, ["branch", "-f", "observe-side", baseCommit]);
  runTestGit(repositoryRoot, ["checkout", "observe-side"]);
  await commitFile(repositoryRoot, {
    relativePath: "shared.txt",
    content: "main side\n",
    message: "main side",
  });
  runTestGit(repositoryRoot, ["checkout", "main"]);
  try {
    runTestGit(integration.path, ["merge", "--no-edit", "observe-side"]);
  } catch {
    // conflict 開始までが目的。MERGE_HEAD の残置は呼び出し側の観測で確認する。
  }
  return integration.path;
}

describe("observeGit: 初期状態と観測不能の扱い", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(async () => {
    ({ parentDir, repositoryRoot } = await createIsolatedRepo());
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("初期状態は canonical = clean / integration = missing", async () => {
    expect.hasAssertions();
    const observation = await observeGit({
      repositoryRoot,
      integrationWorktreePath: path.join(parentDir, "not-created-ws"),
    });
    expect(observation.canonicalHead).toBe(parseCommitId(revParseHead(repositoryRoot)));
    expect(observation.canonicalWorktree).toBe("clean");
    expect(observation.integrationWorkspace).toBe("missing");
  });

  it("canonical HEAD を解決できない場合は型付きエラーになる（観測不能を状態値に丸めない）", async () => {
    expect.hasAssertions();
    // .git を退避して rev-parse を失敗させる。
    fs.renameSync(path.join(repositoryRoot, ".git"), path.join(repositoryRoot, ".git-broken"));
    await expect(
      observeGit({ repositoryRoot, integrationWorktreePath: path.join(parentDir, "ws-x") }),
    ).rejects.toThrow(GitObservationError);
  });
});

describe("observeGit: dirty と merge_in_progress の区別", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(async () => {
    ({ parentDir, repositoryRoot } = await createIsolatedRepo());
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("未コミットの変更は dirty を報告する", async () => {
    expect.hasAssertions();
    const baseCommit = parseCommitId(revParseHead(repositoryRoot));
    const integration = await allocateWorkspace({
      repositoryRoot,
      workspaceId: parseWorkspaceId("ws-integration"),
      baseCommit,
    });

    fs.writeFileSync(path.join(integration.path, "draft.txt"), "wip\n", "utf-8");
    const dirtyObservation: GitObservation = await observeGit({
      repositoryRoot,
      integrationWorktreePath: integration.path,
    });
    expect(dirtyObservation.integrationWorkspace).toBe("dirty");
  });

  it("worktree 上で merge が進行中なら merge_in_progress を報告する（canonical は clean のまま）", async () => {
    expect.hasAssertions();
    const integrationPath = await seedMergeInProgress(repositoryRoot);

    const mergingObservation: GitObservation = await observeGit({
      repositoryRoot,
      integrationWorktreePath: integrationPath,
    });
    expect(mergingObservation.integrationWorkspace).toBe("merge_in_progress");
    // canonical 側は branch 操作だけなので clean のままである。
    expect(mergingObservation.canonicalWorktree).toBe("clean");
  });
});
