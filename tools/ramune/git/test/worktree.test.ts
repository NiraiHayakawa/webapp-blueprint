import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorktreePreconditionError, allocateWorkspace, reclaimWorkspace } from "../src/index.ts";
import { arbitraryShaHex, parseCommitId, parseWorkspaceId } from "./support/journal-fixture.ts";
import { commitFile, createGitRepo, revParseHead, runTestGit } from "./support/fake-git-repo.ts";

// 隔離 worktree の割当と回収（設計正本 §6.1）の公開契約。workspaceId / baseCommit
// は graph パッケージの allocator / claim_ready が発番した値がそのまま来るため、
// テストでは zod スキーマで mint して境界を再現する。
//
// eslint/max-lines-per-function に収めるため、describe は兄弟に分けている。

async function createIsolatedRepo(): Promise<{ parentDir: string; repositoryRoot: string }> {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-worktree-test-"));
  return { parentDir, repositoryRoot: await createGitRepo(parentDir) };
}

describe("allocateWorkspace: baseCommit を起点とする隔離 worktree を作る", () => {
  let repositoryRoot: string;
  let parentDir: string;

  beforeEach(async () => {
    ({ parentDir, repositoryRoot } = await createIsolatedRepo());
  });
  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("worktree を .ramune/workspaces/<workspaceId> に作り、HEAD は baseCommit から始まる", async () => {
    expect.hasAssertions();
    const baseCommit = parseCommitId(revParseHead(repositoryRoot));
    const workspace = await allocateWorkspace({
      repositoryRoot,
      workspaceId: parseWorkspaceId("ws-1"),
      baseCommit,
    });

    expect(workspace.path).toBe(path.join(repositoryRoot, ".ramune", "workspaces", "ws-1"));
    expect(fs.existsSync(workspace.path)).toBe(true);
    expect(runTestGit(workspace.path, ["rev-parse", "HEAD"])).toBe(baseCommit);
  });

  it("割り当てごとに独立したブランチを持ち、2 つの worktree は互いに干渉しない", async () => {
    expect.hasAssertions();
    const baseCommit = parseCommitId(revParseHead(repositoryRoot));
    const first = await allocateWorkspace({
      repositoryRoot,
      workspaceId: parseWorkspaceId("ws-1"),
      baseCommit,
    });
    const second = await allocateWorkspace({
      repositoryRoot,
      workspaceId: parseWorkspaceId("ws-2"),
      baseCommit,
    });
    expect(first.branch).not.toBe(second.branch);

    await commitFile(first.path, {
      relativePath: "shared.txt",
      content: "from ws-1\n",
      message: "edit in ws-1",
    });
    // canonical 側と他方の worktree には波及しない。
    expect(fs.existsSync(path.join(second.path, "shared.txt"))).toBe(false);
    expect(fs.existsSync(path.join(repositoryRoot, "shared.txt"))).toBe(false);
  });
});

describe("allocateWorkspace: 前提条件を満たさない割当は型付きエラーで拒否する", () => {
  let repositoryRoot: string;
  let parentDir: string;

  beforeEach(async () => {
    ({ parentDir, repositoryRoot } = await createIsolatedRepo());
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("存在しない baseCommit は拒否する", async () => {
    expect.hasAssertions();
    await expect(
      allocateWorkspace({
        repositoryRoot,
        workspaceId: parseWorkspaceId("ws-1"),
        baseCommit: arbitraryShaHex("0"),
      }),
    ).rejects.toThrow(WorktreePreconditionError);
  });

  it("同一 workspaceId の再割当は拒否する（allocator の一意性前提を機械で守る）", async () => {
    expect.hasAssertions();
    const baseCommit = parseCommitId(revParseHead(repositoryRoot));
    const input = { repositoryRoot, workspaceId: parseWorkspaceId("ws-1"), baseCommit };
    await allocateWorkspace(input);
    await expect(allocateWorkspace(input)).rejects.toThrow(WorktreePreconditionError);
  });
});

describe(reclaimWorkspace, () => {
  let repositoryRoot: string;
  let parentDir: string;

  beforeEach(async () => {
    ({ parentDir, repositoryRoot } = await createIsolatedRepo());
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("done 後の回収: worktree ディレクトリとブランチを取り除く", async () => {
    expect.hasAssertions();
    const baseCommit = parseCommitId(revParseHead(repositoryRoot));
    const workspace = await allocateWorkspace({
      repositoryRoot,
      workspaceId: parseWorkspaceId("ws-1"),
      baseCommit,
    });

    await reclaimWorkspace({ repositoryRoot, workspaceId: parseWorkspaceId("ws-1") });

    expect(fs.existsSync(workspace.path)).toBe(false);
    expect(runTestGit(repositoryRoot, ["branch", "--list", workspace.branch])).toBe("");
  });

  it("未割当の workspaceId の回収は型付きエラーで拒否する（回収漏れの隠蔽をしない）", async () => {
    expect.hasAssertions();
    await expect(
      reclaimWorkspace({ repositoryRoot, workspaceId: parseWorkspaceId("ws-none") }),
    ).rejects.toThrow(WorktreePreconditionError);
  });
});
