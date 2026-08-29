import fs from "node:fs";
import path from "node:path";

/**
 * hook / mode / locator のテストが共有する「git リポジトリの形をした一時
 * ディレクトリ」の組み立て。実際に `git init` / `git worktree add` を実行すると
 * テストが git バイナリとネットワーク状態に依存するため、hook の契約が観測する
 * ファイル配置（`.git` ディレクトリ、linked worktree の `.git` ファイル、
 * `.ramune/graph.json`）だけを再現する。
 */

/** `.git` ディレクトリと `.ramune/` を持つ canonical リポジトリを作り、そのルートを返す。 */
export function createCanonicalRepo(parentDir: string): string {
  const repositoryRoot = path.join(parentDir, "canonical-repo");
  fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repositoryRoot, ".ramune"), { recursive: true });
  return repositoryRoot;
}

/**
 * canonical リポジトリの sibling として linked worktree を作り、そのルートを返す。
 * git が linked worktree のルートに置く `.git` ファイル（`gitdir:
 * <canonical>/.git/worktrees/<name>` の1行）を実物と同じ形で書く。
 */
export function createLinkedWorktree(canonicalRepositoryRoot: string, name = "worktree"): string {
  const worktreeRoot = path.join(path.dirname(canonicalRepositoryRoot), name);
  const worktreeGitPath = path.join(canonicalRepositoryRoot, ".git", "worktrees", name);
  fs.mkdirSync(worktreeRoot, { recursive: true });
  fs.mkdirSync(worktreeGitPath, { recursive: true });
  fs.writeFileSync(path.join(worktreeRoot, ".git"), `gitdir: ${worktreeGitPath}\n`, "utf-8");
  return worktreeRoot;
}

export function writeGraphFile(repositoryRoot: string, content: string): void {
  fs.mkdirSync(path.join(repositoryRoot, ".ramune"), { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, ".ramune", "graph.json"), content, "utf-8");
}

/** 設計正本 §2 の `GraphSession` の形（テストが組み立てる JSON の契約）。 */
export type V2SessionJson =
  | { readonly state: "active"; readonly runId: string; readonly epoch: number }
  | { readonly state: "inactive" };

/** 設計正本 §2 の v2 グラフのうち、mode 判定に関係する session 以外を最小限で固めた形。 */
export function v2GraphJson(session: V2SessionJson): string {
  return JSON.stringify({
    version: 2,
    revision: 0,
    nextAllocationId: 1,
    goal: "goal",
    session,
    nodes: [],
  });
}
