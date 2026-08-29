// ディレクトリツリーの走査・削除だけを持つモジュール。生成物の中身の
// 組み立て（generated-content.mjs）とは関心が別（design doc 原則7）。

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
function isErrnoException(error) {
  return error instanceof Error && "code" in error;
}

/** @param {string} filePath */
async function readOrNull(filePath) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * @param {string} prefix
 * @param {string} name
 */
function joinRelPath(prefix, name) {
  if (prefix) {
    return `${prefix}/${name}`;
  }
  return name;
}

/**
 * @param {import("node:fs").Dirent} entryA
 * @param {import("node:fs").Dirent} entryB
 */
function byName(entryA, entryB) {
  return entryA.name.localeCompare(entryB.name);
}

/**
 * 1 エントリを相対パスの配列に展開する（ディレクトリは再帰、ファイルは
 * 自身、その他の種別は未対応として例外にする。silent skip 禁止）。
 * @param {string} dir
 * @param {string} prefix
 * @param {import("node:fs").Dirent} entry
 * @returns {Promise<string[]>}
 */
async function expandEntry(dir, prefix, entry) {
  const relPath = joinRelPath(prefix, entry.name);
  if (entry.isDirectory()) {
    return await listFilesRecursive(path.join(dir, entry.name), relPath);
  }
  if (entry.isFile()) {
    return [relPath];
  }
  throw new Error(`未対応のファイル種別です: ${path.join(dir, entry.name)}`);
}

/**
 * dir 以下のすべてのファイルを相対パス（'/' 区切り、ソート済み）で列挙する。
 * dir が存在しなければ空配列を返す（未作成の正本ディレクトリは
 * 「まだ skill が無い」という有効な状態として扱う）。
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function listFilesRecursive(dir, prefix = "") {
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const sortedEntries = entries.toSorted(byName);
  const nested = await Promise.all(
    sortedEntries.map(async (entry) => await expandEntry(dir, prefix, entry)),
  );
  return nested.flat();
}

/** @param {string} dir */
async function removeIfEmpty(dir, protectedDir) {
  if (dir === protectedDir) {
    // protectedDir 自体は空でも残す
    return;
  }
  const remaining = await fs.readdir(dir);
  if (remaining.length === 0) {
    await fs.rmdir(dir);
  }
}

/**
 * dir 以下の空ディレクトリを再帰的に削除する。protectedDir 自体は
 * 空でも残す（同期先ディレクトリ自体を消すと次回書き込みが失敗する）。
 * @param {string} dir
 * @param {string} protectedDir
 */
async function removeEmptyDirsUnder(dir, protectedDir) {
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        await removeEmptyDirsUnder(path.join(dir, entry.name), protectedDir);
      }),
  );

  await removeIfEmpty(dir, protectedDir);
}

export { listFilesRecursive, readOrNull, removeEmptyDirsUnder };
