import fs from "node:fs";
import path from "node:path";

const IGNORED_DIRECTORY_NAMES = new Set(["node_modules", ".git"]);

/** 隠しファイル・無視対象ディレクトリ名かどうか。 */
function isIgnoredEntryName(entryName: string): boolean {
  return entryName.startsWith(".") || IGNORED_DIRECTORY_NAMES.has(entryName);
}

/**
 * `currentDir` 直下のエントリを走査し、ディレクトリは `stack` に積んで
 * 再帰対象に加え、ファイルは `result` に集約する。
 */
function collectDirectoryEntries(currentDir: string, stack: string[], result: string[]): void {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (isIgnoredEntryName(entry.name)) {
      continue;
    }
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      stack.push(entryPath);
    } else if (entry.isFile()) {
      result.push(entryPath);
    }
  }
}

/**
 * 指定ディレクトリ配下の全ファイルを再帰的に列挙する(ファイル種別を問わない)。
 * ディレクトリ名/ファイル名のパターンを対象とするルール(禁止ディレクトリ名・
 * `.feature` / spec の対応)が、ts-morph の Project が読み込まない
 * ファイル(`.feature` など)にも到達するために使う。
 */
export function walkFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const result: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (currentDir === undefined) {
      continue;
    }
    collectDirectoryEntries(currentDir, stack, result);
  }

  return result;
}
