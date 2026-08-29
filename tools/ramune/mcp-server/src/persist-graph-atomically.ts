// .ramune/graph.json への atomic replace（設計正本 §4。store.ts から抽出）。
//
// 同一ディレクトリの一時ファイルへ書いて fsync → rename → 親ディレクトリ fsync の
// 順で行う。rename は同一ディレクトリ内なので原子的であり、読み手は完全な旧内容か
// 完全な新内容のどちらかだけを見る（torn write を構造的に排除）。永続化するバイト列が
// GraphV2 契約を満たすことは、呼び出し側（store.ts）が rename 前に parseGraph で
// 確認済みであることを前提とする。
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import fs from "node:fs/promises";
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import path from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import { randomUUID } from "node:crypto";

async function writeThenFsync(temporaryPath: string, text: string): Promise<void> {
  const handle = await fs.open(temporaryPath, "w");
  try {
    await handle.writeFile(text, "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryEntry(directory: string): Promise<void> {
  const directoryHandle = await fs.open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function removeLeftoverTemporaryFile(temporaryPath: string): Promise<void> {
  try {
    await fs.unlink(temporaryPath);
  } catch {
    // rename 済みで一時ファイルが既に無い場合はここに来る。無視してよい。
  }
}

/** 検証済みテキストを graph.json へ atomic replace で書き込む。 */
export async function persistGraphAtomically(
  directory: string,
  filePath: string,
  text: string,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.graph.json.tmp-${randomUUID()}`);
  try {
    await writeThenFsync(temporaryPath, text);
    await fs.rename(temporaryPath, filePath);
    // rename の完了をディレクトリエントリにも永続させる
    await syncDirectoryEntry(directory);
  } catch (error) {
    // open 以降のどの時点（writeFile / sync / rename / ディレクトリ fsync）で
    // 失敗しても、一時ファイルを .ramune/ に残さない。rename 済みなら
    // unlink は ENOENT になるためそれだけを無視し、元の失敗は rethrow する
    await removeLeftoverTemporaryFile(temporaryPath);
    throw error;
  }
}
