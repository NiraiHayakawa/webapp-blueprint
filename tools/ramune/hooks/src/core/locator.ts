/**
 * PreToolUse hook の呼び出し元ディレクトリ（任意の worktree の cwd）から、
 * canonical リポジトリのルートを解決する。
 */
import fs from "node:fs";
import path from "node:path";

const GIT_ENTRY_NAME = ".git";
const GITDIR_PREFIX = "gitdir: ";
const WORKTREES_DIR_NAME = "worktrees";

/**
 * canonical リポジトリのルートを解決できないときに投げる型付きエラー。
 * 判定不能を非稼働や許可側に丸めない（fail-closed）。
 */
export class GraphLocatorError extends Error {
  constructor(reason: string) {
    super(
      `canonical なリポジトリの位置を特定できませんでした（${reason}）。` +
        `ramune の PreToolUse hook は git リポジトリまたはその linked worktree の中から呼ばれる必要があります。`,
    );
    this.name = "GraphLocatorError";
  }
}

/** 親方向に辿って見つけた `.git` エントリ。git はこれをディレクトリまたはファイルのどちらかの形で置く。 */
interface GitEntry {
  readonly entryPath: string;
  readonly isDirectory: boolean;
}

function findGitEntry(sessionWorkingDirectory: string): GitEntry | undefined {
  let current = path.resolve(sessionWorkingDirectory);
  for (;;) {
    const entryPath = path.join(current, GIT_ENTRY_NAME);
    try {
      const stat = fs.statSync(entryPath);
      return { entryPath, isDirectory: stat.isDirectory() };
    } catch {
      // この階層には .git がない。親へ辿る
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function readWorktreeGitFile(gitFile: string): string {
  try {
    return fs.readFileSync(gitFile, "utf-8");
  } catch (error) {
    throw new GraphLocatorError(`${gitFile} を読み取れません（${String(error)}）`);
  }
}

/**
 * linked worktree の `.git` ファイルから gitdir の指先
 * （`<canonical>/.git/worktrees/<name>`）を絶対パスで取り出す。
 */
function parseWorktreeGitdir(gitFile: string): string {
  const firstLine = readWorktreeGitFile(gitFile).split("\n", 1)[0]?.trim() ?? "";
  if (!firstLine.startsWith(GITDIR_PREFIX)) {
    throw new GraphLocatorError(`${gitFile} の1行目が "${GITDIR_PREFIX}" で始まっていません`);
  }

  const target = firstLine.slice(GITDIR_PREFIX.length).trim();
  if (target.length === 0) {
    throw new GraphLocatorError(`${gitFile} の gitdir が空です`);
  }

  // gitdir は相対パスで書かれることがあるため、.git ファイルの位置を基準に解決する。
  return path.resolve(path.dirname(gitFile), target);
}

/**
 * linked worktree の gitdir（`<canonical>/.git/worktrees/<name>`）から
 * `<canonical>/.git` を割り出し、その親＝canonical リポジトリのルートを返す。
 */
function canonicalRootFromGitdir(worktreeRoot: string, gitdirTarget: string): string {
  const worktreesDir = path.dirname(gitdirTarget);
  const commonGitDir = path.dirname(worktreesDir);
  if (
    path.basename(worktreesDir) !== WORKTREES_DIR_NAME ||
    path.basename(commonGitDir) !== GIT_ENTRY_NAME
  ) {
    throw new GraphLocatorError(
      `${worktreeRoot} の gitdir（${gitdirTarget}）が linked worktree の配置 ` +
        `（<canonical>/.git/${WORKTREES_DIR_NAME}/<name>）になっていません`,
    );
  }

  let commonGitDirIsDirectory = false;
  try {
    commonGitDirIsDirectory = fs.statSync(commonGitDir).isDirectory();
  } catch {
    // 存在しない（stale）。
  }
  if (!commonGitDirIsDirectory) {
    throw new GraphLocatorError(`gitdir の指先 ${commonGitDir} がディレクトリとして存在しません`);
  }

  return path.dirname(commonGitDir);
}

/**
 * セッションの作業ディレクトリ（canonical リポジトリ内でもどの worktree 内でもよい）
 * から canonical リポジトリのルートを解決して返す。解決できない場合は
 * `GraphLocatorError` を投げる。
 */
export function resolveCanonicalRepositoryRoot(sessionWorkingDirectory: string): string {
  const entry = findGitEntry(sessionWorkingDirectory);
  if (entry === undefined) {
    throw new GraphLocatorError(
      `${sessionWorkingDirectory} から親方向に ${GIT_ENTRY_NAME} を辿れません`,
    );
  }

  if (entry.isDirectory) {
    return path.dirname(entry.entryPath);
  }

  const gitdirTarget = parseWorktreeGitdir(entry.entryPath);
  return canonicalRootFromGitdir(path.dirname(entry.entryPath), gitdirTarget);
}
