// git CLI と任意コマンドの実行を担う最下層。このパッケージ内のすべての外部
// プロセス起動はこのファイル経由で行う（引数は必ず配列で渡し、shell を使わない
// ため候補コミットやファイル名由来の値がシェル解釈される余地がない）。
//
// 出力は上限付きでバッファする。検証コマンドの出力は outputDigest の材料になる
// ため丸めて捨てられない一方、無上限では暴走した検証コマンドがメモリを食い潰す。
// 上限超過は打ち切りではなく型付きエラーで失敗させる（ダイジェストが部分的な
// 出力を指す状態を作らない。docs/principles/fail-fast.md）。
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import type { Readable } from "node:stream";

import { ProcessError } from "./process-error.ts";
import { GitCommandError } from "./git-command-error.ts";

// oxlint-disable-next-line eslint/no-magic-numbers -- 16 MiB。異常な大量出力は丸めた証跡を作るより失敗させる（上限値そのものに契約上の意味はない）。
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface ProcessOutcome {
  /** 終了コード。シグナル終了では null になる。 */
  readonly exitCode: number | null;
  readonly terminatedBySignal: boolean;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

interface StreamAccumulator {
  buffer: Buffer;
  overflowed: boolean;
}

interface Collectors {
  readonly stdoutAccumulator: StreamAccumulator;
  readonly stderrAccumulator: StreamAccumulator;
  overflowReason: string | undefined;
}

function watchStream(
  stream: Readable,
  accumulator: StreamAccumulator,
  onOverflow: () => void,
): void {
  stream.on("data", (chunk: Buffer) => {
    accumulator.buffer =
      accumulator.buffer.byteLength === 0 ? chunk : Buffer.concat([accumulator.buffer, chunk]);
    if (accumulator.buffer.byteLength > MAX_OUTPUT_BYTES && !accumulator.overflowed) {
      accumulator.overflowed = true;
      onOverflow();
    }
  });
}

function spawnChild(command: readonly string[], cwd: string): ChildProcess {
  const [commandName, ...restArgs] = command;
  if (commandName === undefined) {
    throw new ProcessError(command, "実行コマンドが空");
  }
  return spawn(commandName, restArgs, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function wireCollectors(child: ChildProcess): Collectors {
  const collectors: Collectors = {
    stdoutAccumulator: { buffer: Buffer.alloc(0), overflowed: false },
    stderrAccumulator: { buffer: Buffer.alloc(0), overflowed: false },
    overflowReason: undefined,
  };
  // stdio を ["ignore","pipe","pipe"] で spawn しているため、両ストリームは存在する。
  const { stdout: stdoutStream, stderr: stderrStream } = child;
  if (stdoutStream === null || stderrStream === null) {
    throw new ProcessError([], "標準出力 / 標準エラーをパイプとして開けませんでした");
  }
  watchStream(stdoutStream, collectors.stdoutAccumulator, () => {
    collectors.overflowReason = `標準出力が上限（${MAX_OUTPUT_BYTES} バイト）を超えた`;
    child.kill();
  });
  watchStream(stderrStream, collectors.stderrAccumulator, () => {
    collectors.overflowReason = `標準エラーが上限（${MAX_OUTPUT_BYTES} バイト）を超えた`;
    child.kill();
  });
  return collectors;
}

/** close イベントまで待つ。起動失敗（error イベント）は ProcessError へ変換する。 */
async function waitForExit(command: readonly string[], child: ChildProcess): Promise<void> {
  try {
    await once(child, "close");
  } catch (error) {
    throw new ProcessError(command, String(error));
  }
}

/**
 * コマンドを実行し、終了コードと生の出力をそのまま返す。
 * 非ゼロ終了は呼び出し側の意味づけ（conflict は正常系の一部 等）に委ねるため
 * ここでは拒否しない。拒否するのは起動失敗と出力上限超過のみである。
 * 終了状態は close 後の child.exitCode / child.signalCode から読む。
 */
export async function runProcess(command: readonly string[], cwd: string): Promise<ProcessOutcome> {
  const child = spawnChild(command, cwd);
  const collectors = wireCollectors(child);
  await waitForExit(command, child);

  if (collectors.overflowReason !== undefined) {
    throw new ProcessError(command, collectors.overflowReason);
  }
  return {
    exitCode: child.exitCode,
    terminatedBySignal: child.signalCode !== null,
    stdout: collectors.stdoutAccumulator.buffer,
    stderr: collectors.stderrAccumulator.buffer,
  };
}

/** git コマンドの実行結果。非ゼロ終了も含めて観測したい呼び出し側のための形。 */
export async function runGitOutcome(cwd: string, args: readonly string[]): Promise<ProcessOutcome> {
  try {
    return await runProcess(["git", ...args], cwd);
  } catch (error) {
    if (error instanceof ProcessError) {
      throw new GitCommandError({
        args,
        exitCode: null,
        stderrText: "",
        detail: `git を起動できませんでした（${String(error)}）`,
      });
    }
    throw error;
  }
}

/** git コマンドを実行し、成功時は標準出力（前後の空白除去済み）を返す。 */
export async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  const outcome = await runGitOutcome(cwd, args);
  if (outcome.exitCode !== 0) {
    throw new GitCommandError({
      args,
      exitCode: outcome.exitCode,
      stderrText: outcome.stderr.toString("utf-8"),
    });
  }
  return outcome.stdout.toString("utf-8").trim();
}

/** 指定した commitish がこのリポジトリ（または共有オブジェクト DB）で解決できるか。 */
export async function commitExists(cwd: string, commitish: string): Promise<boolean> {
  const outcome = await runGitOutcome(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${commitish}^{commit}`,
  ]);
  return outcome.exitCode === 0;
}
