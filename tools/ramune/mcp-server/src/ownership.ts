// graph 配置パス（canonical リポジトリルート）の所有検査と主張（設計正本 §5）。
//
// サーバーは起動時に次の2点を検査し、不一致は fail-closed で拒否する:
//   1. repositoryRoot が git リポジトリルートであること（.git が存在する）
//   2. 同じ .ramune/ 配置パスを、別の生きているサーバープロセスが既に所有して
//      いないこと
//
// 「所有」の記録は `.ramune/server-owner.json`（pid・リポジトリルート・起動時刻）。
// マーカーの pid が死んでいる場合は前プロセスの残骸であり、引き継いで書き直す
// （crash 後の再起動を妨げない。生きている所有者との競合だけが拒否対象）。
// port bind 排他（ADR 0013）が二重起動の第一線であり、このマーカーは「別ディレクトリ
// から同じ .ramune/ を指して起動した」ケースの第二線として働く。
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import fs from "node:fs/promises";
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import path from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import process from "node:process";
import { z } from "zod";
import { GraphPathOwnershipError } from "./graph-path-ownership-error.ts";
import { isErrnoException } from "./is-errno-exception.ts";

const OWNER_RELATIVE_PATH = ".ramune/server-owner.json";

const ownerMarkerSchema = z.object({
  pid: z.number(),
  repositoryRoot: z.string(),
  startedAt: z.string(),
});

type OwnerMarker = z.infer<typeof ownerMarkerSchema>;

/** プロセスが生存しているか（kill(pid, 0) のシグナル無送信確認）。 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = 該当プロセスが存在しない。EPERM は生存しているが権限がない意味であり、
    // 生存扱いにする（fail-closed）。ErrnoException と判定できない例外は
    // 「生存しているかどうか確定できない」ため、fail-closed で生存扱いにする。
    return !isErrnoException(error) || error.code !== "ESRCH";
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readOwnerMarker(ownerFilePath: string): Promise<OwnerMarker | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(ownerFilePath, "utf-8"));
    return ownerMarkerSchema.parse(parsed);
  } catch {
    return undefined;
  }
}

function rejectIfOwnedByLiveProcess(
  repositoryRoot: string,
  existing: OwnerMarker | undefined,
): void {
  if (
    existing === undefined ||
    !Number.isSafeInteger(existing.pid) ||
    !isProcessAlive(existing.pid)
  ) {
    return;
  }
  // 生存マーカーは「別のサーバープロセスが所有中」を意味する。同一 pid の
  // 再入も許さない（fail-closed。正常な再起動では旧プロセスは死んでいるため
  // マーカーの pid も死んでいて、この分岐には到達しない）
  throw new GraphPathOwnershipError(
    repositoryRoot,
    `別のサーバープロセス（pid=${String(existing.pid)}）が既にこの配置パスを所有している。` +
      "複数セッションは同一サーバーへ HTTP 接続すること（ADR 0013）",
  );
}

async function writeOwnerMarker(ownerFilePath: string, repositoryRoot: string): Promise<void> {
  const marker: OwnerMarker = {
    pid: process.pid,
    repositoryRoot,
    startedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(ownerFilePath), { recursive: true });
  await fs.writeFile(ownerFilePath, `${JSON.stringify(marker, null, 2)}\n`, "utf-8");
}

/**
 * graph 配置パスの所有を検査し、問題なければ自分を所有者としてマークする。
 * 失敗時はマーカーを書かずに投げる（部分適用を残さない）。
 */
export async function acquireGraphPathOwnership(repositoryRoot: string): Promise<void> {
  if (!(await pathExists(path.join(repositoryRoot, ".git")))) {
    throw new GraphPathOwnershipError(
      repositoryRoot,
      "git リポジトリルートではない（.git が無い）。ramune MCP サーバーは canonical リポジトリルートから起動する必要がある",
    );
  }

  const ownerFilePath = path.join(repositoryRoot, OWNER_RELATIVE_PATH);
  const existing = await readOwnerMarker(ownerFilePath);
  rejectIfOwnedByLiveProcess(repositoryRoot, existing);
  await writeOwnerMarker(ownerFilePath, repositoryRoot);
}

/** 終了時に所有マーカーを取り除く。既に無い場合（crash 後の後片付け等）は無視。 */
export async function releaseGraphPathOwnership(repositoryRoot: string): Promise<void> {
  try {
    await fs.unlink(path.join(repositoryRoot, OWNER_RELATIVE_PATH));
  } catch {
    // 既にマーカーが無い場合（crash 後の後片付け等）は無視してよい。
  }
}
