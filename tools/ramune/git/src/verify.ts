// 1 コマンド検証（絶対規約 8）の実行と証跡生成（設計正本 §6.2 step 3）。
//
// 検証コマンドは注入可能である。既定は mise run check であり、テストは軽量な
// コマンドに差し替えて機構を検証する。これは設定可能化であって silent fallback
// ではない（実行したコマンドを executedCommand として常に記録し、証跡の
// command フィールドが嘘をつかないことを型と検査で保証する）。
//
// graph パッケージの SuccessfulCheck / FailedCheck は command を literal
// "mise run check" として要求する。その証跡を作れるのは実際に
// DEFAULT_VERIFICATION_COMMAND を実行した測定値に対してだけである
// （miseRunCheckEvidence がそれ以外を拒否する）。WP3 の配線は既定コマンドで
// runVerification を呼び、戻り値の測定値からこの関数で証跡を作る。
import { createHash } from "node:crypto";

import {
  digestSchema,
  isoDateTimeSchema,
  nonZeroExitCodeSchema,
  type CommitId,
  type Digest,
  type FailedCheck,
  type IsoDateTime,
  type SuccessfulCheck,
} from "@webapp-blueprint/ramune-graph";

import { runProcess, type ProcessOutcome } from "./git-command.ts";
import { ProcessError } from "./process-error.ts";
import { VerificationProcessError } from "./verification-process-error.ts";
import { VerificationEvidenceError } from "./verification-evidence-error.ts";

/** 既定の検証コマンド（絶対規約 8「検証は 1 コマンド」）。 */
export const DEFAULT_VERIFICATION_COMMAND: readonly string[] = Object.freeze([
  "mise",
  "run",
  "check",
]);

export interface RunVerificationInput {
  /** 検証を実行する作業ディレクトリ（統合用 worktree のルート等）。 */
  readonly cwd: string;
  /** 検証対象のコミット（統合コミット）。証跡の checkedCommit になる。 */
  readonly checkedCommit: CommitId;
  /**
   * 実行する検証コマンド。省略時は DEFAULT_VERIFICATION_COMMAND。
   * 証跡（miseRunCheckEvidence）は既定コマンドの実行結果にしか作れない。
   */
  readonly command?: readonly string[];
}

/**
 * 検証コマンドの生の測定値。graph パッケージの証跡型とは意図的に分けてある:
 * 任意のコマンドの実行結果を正直に記録するのがこの型の責務であり、
 * 「mise run check の証跡」という意味づけは miseRunCheckEvidence の責務である。
 */
export interface VerificationMeasurement {
  readonly executedCommand: readonly string[];
  readonly checkedCommit: CommitId;
  readonly exitCode: number;
  /** stdout バイト列の直後に stderr バイト列を連結した内容の SHA-256（16 進小文字）。 */
  readonly outputDigest: Digest;
  readonly finishedAt: IsoDateTime;
}

function sameCommandAsDefault(command: readonly string[]): boolean {
  return (
    command.length === DEFAULT_VERIFICATION_COMMAND.length &&
    DEFAULT_VERIFICATION_COMMAND.every((part, index) => command[index] === part)
  );
}

function digestOf(stdout: Buffer, stderr: Buffer): Digest {
  const digestHex = createHash("sha256")
    .update(Buffer.concat([stdout, stderr]))
    .digest("hex");
  return digestSchema.parse(digestHex);
}

function finishedAtNow(): IsoDateTime {
  return isoDateTimeSchema.parse(new Date().toISOString());
}

/** 検証を実行する。起動系の失敗は VerificationProcessError へ変換する。 */
async function executeVerification(
  command: readonly string[],
  cwd: string,
): Promise<ProcessOutcome> {
  try {
    return await runProcess(command, cwd);
  } catch (error) {
    if (error instanceof ProcessError) {
      throw new VerificationProcessError(command, String(error));
    }
    throw error;
  }
}

/** 終了コードとして記録できない終わり方（シグナル死亡等）を拒否する。 */
function assertRecordableExit(command: readonly string[], outcome: ProcessOutcome): number {
  if (outcome.terminatedBySignal || outcome.exitCode === null) {
    throw new VerificationProcessError(
      command,
      `プロセスがシグナル等で異常終了しました（exitCode=${String(outcome.exitCode)}）`,
    );
  }
  return outcome.exitCode;
}

/**
 * 検証コマンドを実行して測定する。非ゼロ終了は失敗ではなく「測定結果」である
 * （FailedCheck 証跡の材料になる）。証跡化できない終了（シグナルによる死亡・
 * 起動失敗・出力上限超過）のみ VerificationProcessError で拒否する。
 */
export async function runVerification(
  input: RunVerificationInput,
): Promise<VerificationMeasurement> {
  const { cwd, checkedCommit } = input;
  const command = input.command ?? DEFAULT_VERIFICATION_COMMAND;

  const outcome = await executeVerification(command, cwd);
  const exitCode = assertRecordableExit(command, outcome);

  return {
    executedCommand: command,
    checkedCommit,
    exitCode,
    outputDigest: digestOf(outcome.stdout, outcome.stderr),
    finishedAt: finishedAtNow(),
  };
}

/**
 * 測定値を graph パッケージの証跡（SuccessfulCheck | FailedCheck）に変換する。
 * 対象が既定コマンド（mise run check）の実行結果でない場合は拒否する —
 * 証跡の command フィールドは「実行したコマンド」の宣言であり、別コマンドの
 * 結果にこの名前を冠させることは証跡の偽装である。
 */
export function miseRunCheckEvidence(
  measurement: VerificationMeasurement,
): SuccessfulCheck | FailedCheck {
  if (!sameCommandAsDefault(measurement.executedCommand)) {
    throw new VerificationEvidenceError(measurement.executedCommand);
  }

  if (measurement.exitCode === 0) {
    const evidence: SuccessfulCheck = {
      command: "mise run check",
      checkedCommit: measurement.checkedCommit,
      exitCode: 0,
      outputDigest: measurement.outputDigest,
      finishedAt: measurement.finishedAt,
    };
    return evidence;
  }

  const evidence: FailedCheck = {
    command: "mise run check",
    checkedCommit: measurement.checkedCommit,
    exitCode: nonZeroExitCodeSchema.parse(measurement.exitCode),
    outputDigest: measurement.outputDigest,
    finishedAt: measurement.finishedAt,
  };
  return evidence;
}
