import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphLocatorError, resolveCanonicalRepositoryRoot } from "../../src/core/locator.ts";
import { createCanonicalRepo, createLinkedWorktree } from "../support/fake-repo.ts";

const BROKEN_GIT_FILE_CASES = [
  {
    name: ".git ファイルの1行目が gitdir: で始まっていない",
    writeGitFile: (worktreeRoot: string, parentDir: string): void => {
      void parentDir;
      fs.writeFileSync(path.join(worktreeRoot, ".git"), "gitdir-is-missing\n", "utf-8");
    },
  },
  {
    name: ".git ファイルの gitdir が空",
    writeGitFile: (worktreeRoot: string, parentDir: string): void => {
      void parentDir;
      fs.writeFileSync(path.join(worktreeRoot, ".git"), "gitdir: \n", "utf-8");
    },
  },
  {
    name: "gitdir の指先が linked worktree の配置（.git/worktrees/<name>）ではない",
    writeGitFile: (worktreeRoot: string, parentDir: string): void => {
      const mainRoot = path.join(parentDir, "main-repo");
      fs.mkdirSync(path.join(mainRoot, ".git", "modules", "sub"), { recursive: true });
      fs.writeFileSync(
        path.join(worktreeRoot, ".git"),
        `gitdir: ${path.join(mainRoot, ".git", "modules", "sub")}\n`,
        "utf-8",
      );
    },
  },
  {
    name: "gitdir の指先が存在しない（stale な linked worktree）",
    writeGitFile: (worktreeRoot: string, parentDir: string): void => {
      const staleTarget = path.join(parentDir, "gone-repo", ".git", "worktrees", "wt");
      fs.writeFileSync(path.join(worktreeRoot, ".git"), `gitdir: ${staleTarget}\n`, "utf-8");
    },
  },
] as const;

describe("resolveCanonicalRepositoryRoot: canonical リポジトリの解決", () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-locator-test-"));
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("canonical リポジトリのルートそのものを渡すと、そのルートを返す", () => {
    expect.hasAssertions();
    const repositoryRoot = createCanonicalRepo(parentDir);
    expect(resolveCanonicalRepositoryRoot(repositoryRoot)).toBe(repositoryRoot);
  });

  it("canonical リポジトリの子ディレクトリを渡すと、親方向に辿ってルートを返す", () => {
    expect.hasAssertions();
    const repositoryRoot = createCanonicalRepo(parentDir);
    const subDirectory = path.join(repositoryRoot, "apps", "web", "src");
    fs.mkdirSync(subDirectory, { recursive: true });
    expect(resolveCanonicalRepositoryRoot(subDirectory)).toBe(repositoryRoot);
  });
});

describe("resolveCanonicalRepositoryRoot: linked worktree の cwd から canonical リポジトリを返す", () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-locator-test-"));
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("linked worktree のルートを渡すと、canonical リポジトリのルートを返す", () => {
    expect.hasAssertions();
    const repositoryRoot = createCanonicalRepo(parentDir);
    const worktreeRoot = createLinkedWorktree(repositoryRoot);
    expect(resolveCanonicalRepositoryRoot(worktreeRoot)).toBe(repositoryRoot);
  });

  it("linked worktree の子ディレクトリを渡しても、canonical リポジトリのルートを返す", () => {
    expect.hasAssertions();
    const repositoryRoot = createCanonicalRepo(parentDir);
    const worktreeRoot = createLinkedWorktree(repositoryRoot);
    const subDirectory = path.join(worktreeRoot, "tools", "ramune", "hooks");
    fs.mkdirSync(subDirectory, { recursive: true });
    expect(resolveCanonicalRepositoryRoot(subDirectory)).toBe(repositoryRoot);
  });

  it(".git ファイルの gitdir が相対パスで書かれていても解決できる", () => {
    expect.hasAssertions();
    const repositoryRoot = createCanonicalRepo(parentDir);
    const worktreeRoot = createLinkedWorktree(repositoryRoot, "relative-wt");
    const relativeTarget = path.join(
      path.relative(worktreeRoot, repositoryRoot),
      ".git",
      "worktrees",
      "relative-wt",
    );
    fs.writeFileSync(path.join(worktreeRoot, ".git"), `gitdir: ${relativeTarget}\n`, "utf-8");
    expect(resolveCanonicalRepositoryRoot(worktreeRoot)).toBe(repositoryRoot);
  });
});

describe("resolveCanonicalRepositoryRoot: 解決できない場合は GraphLocatorError を投げる（fail-closed）", () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-locator-test-"));
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("親方向に .git が存在しないディレクトリは解決できない", () => {
    expect.hasAssertions();
    const plainDirectory = path.join(parentDir, "plain");
    fs.mkdirSync(plainDirectory, { recursive: true });
    expect(() => resolveCanonicalRepositoryRoot(plainDirectory)).toThrow(GraphLocatorError);
  });

  it.each(BROKEN_GIT_FILE_CASES)(
    "$name ケースは GraphLocatorError を投げる",
    ({ writeGitFile }) => {
      expect.hasAssertions();
      const worktreeRoot = path.join(parentDir, "broken-wt");
      fs.mkdirSync(worktreeRoot, { recursive: true });
      writeGitFile(worktreeRoot, parentDir);
      expect(() => resolveCanonicalRepositoryRoot(worktreeRoot)).toThrow(GraphLocatorError);
    },
  );
});
