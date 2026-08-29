import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * WP6 のテストが共有する「実 git リポジトリ」の fixture。公開契約テストは
 * このパッケージの export 関数の入出力だけを見るが、その入力（コミット SHA や
 * 競合の再現）を組み立てるために最小限の git 操作が必要である。
 * テスト側の git 操作と検証対象の関数が同じ経路（外部プロセスとしての git CLI）
 * を使うことは、「テストが実装の内部ヘルパに依存する」ことではない
 * （git CLI 自体が外部契約）。fixture は一回実行で終わるテストプロセスの
 * 準備手順であるため、同期 API を使う（oxlint.config.ts の Node 専用 override 参照）。
 */

/** git コマンドを実行し、標準出力（前後の空白除去済み）を返す。失敗時は例外。 */
export function runTestGit(cwd: string, args: readonly string[]): string {
  const stdout = execFileSync("git", [...args], { cwd, encoding: "utf-8" });
  return stdout.trim();
}

/** 現在の HEAD の SHA を返す（テストのアサーション入力を組み立てるためのもの）。 */
export function revParseHead(cwd: string): string {
  return runTestGit(cwd, ["rev-parse", "HEAD"]);
}

export interface CommitSpec {
  readonly relativePath: string;
  readonly content: string;
  readonly message: string;
}

/** ファイルを書き換えて commit し、新しい HEAD の SHA を返す。 */
export async function commitFile(repositoryRoot: string, spec: CommitSpec): Promise<string> {
  fs.writeFileSync(path.join(repositoryRoot, spec.relativePath), spec.content, "utf-8");
  runTestGit(repositoryRoot, ["add", spec.relativePath]);
  // gpg 署名は環境によって失敗するため明示的に無効化する（テストの決定性）。
  runTestGit(repositoryRoot, ["commit", "--no-gpg-sign", "-m", spec.message]);
  return revParseHead(repositoryRoot);
}

/**
 * `git init -b main` したリポジトリを initial commit 付きで作り、ルートを返す。
 * readmeContent を変えると初期ツリーが変わるため、別履歴（ルートの異なる
 * コミット）を用意できる。同一秒・同一内容の initial commit は SHA まで一致する
 * （git のコミット ID は内容と時刻から決定的に導出される）ため、履歴を分けたい
 * 場合は必ずこの差し替えを使う。
 */
export async function createGitRepo(
  parentDir: string,
  spec?: { readonly readmeContent?: string },
): Promise<string> {
  const repositoryRoot = path.join(parentDir, "repo");
  fs.mkdirSync(repositoryRoot, { recursive: true });
  runTestGit(repositoryRoot, ["init", "-b", "main"]);
  runTestGit(repositoryRoot, ["config", "user.email", "ramune-test@example.com"]);
  runTestGit(repositoryRoot, ["config", "user.name", "ramune-test"]);
  // 本番リポジトリでは .ramune/（graph.json と隔離 worktree の配置先）が
  // .gitignore 済みである。fixture リポジトリでも同じ前提を info/exclude で再現する
  // （tracked ファイルを作らないため exclude が適切）。
  const gitInfoDir = path.join(repositoryRoot, ".git", "info");
  fs.mkdirSync(gitInfoDir, { recursive: true });
  fs.appendFileSync(path.join(gitInfoDir, "exclude"), ".ramune/\n", "utf-8");
  await commitFile(repositoryRoot, {
    relativePath: "README.md",
    content: spec?.readmeContent ?? "# test repo\n",
    message: "initial",
  });
  return repositoryRoot;
}

/**
 * 検証コマンドのスタブバイナリを binDir に置く。PATH への追加は呼び出し側で
 * 行う（try/finally での復元をテスト本体に明示させるため）。
 */
export function installStubBinary(binDir: string, name: string, scriptBody: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  const binaryPath = path.join(binDir, name);
  fs.writeFileSync(binaryPath, `#!/bin/sh\n${scriptBody}\n`, { mode: 0o755 });
}
