import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FailedCheck, SuccessfulCheck } from "@webapp-blueprint/ramune-graph";
import {
  DEFAULT_VERIFICATION_COMMAND,
  VerificationEvidenceError,
  VerificationProcessError,
  miseRunCheckEvidence,
  runVerification,
} from "../src/index.ts";
import type { VerificationMeasurement } from "../src/index.ts";
import { parseCommitId } from "./support/journal-fixture.ts";
import { createGitRepo, installStubBinary, revParseHead } from "./support/fake-git-repo.ts";

// 1 コマンド検証（絶対規約 8）の実行と証跡生成の公開契約。検証コマンドは
// 注入可能（既定 = mise run check）。重い既定コマンドの代わりに軽量コマンドや
// stub した mise で機構を検証する。outputDigest は「stdout の直後に stderr を
// 連結した UTF-8 バイト列の SHA-256」という契約を固定する。
//
// eslint/max-lines-per-function に収めるため、stub mise を PATH に置いて証跡まで
// 作る共通手順はモジュールスコープのヘルパに切り出し、describe は兄弟に分ける。

// oxlint-disable-next-line eslint/no-magic-numbers -- 検証が「失敗」することまでを見るための任意の非ゼロ値。
const FAILURE_EXIT_CODE = 3;

interface StubEvidence {
  readonly measurement: VerificationMeasurement;
  readonly evidence: SuccessfulCheck | FailedCheck;
}

/** stub した mise を PATH 先頭に置いて既定コマンドを実行し、証跡まで作る。 */
async function evidenceFromStubMise(
  binDir: string,
  cwd: string,
  scriptBody: string,
): Promise<StubEvidence> {
  installStubBinary(binDir, "mise", scriptBody);
  const originalPath = process.env["PATH"];
  process.env["PATH"] = `${binDir}:${originalPath ?? ""}`;
  try {
    const measurement = await runVerification({
      cwd,
      checkedCommit: parseCommitId(revParseHead(cwd)),
    });
    return { measurement, evidence: miseRunCheckEvidence(measurement) };
  } finally {
    process.env["PATH"] = originalPath;
  }
}

describe(runVerification, () => {
  let parentDir: string;
  let cwd: string;

  beforeEach(async () => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-verify-test-"));
    cwd = await createGitRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("成功した検証は exitCode 0 と出力ダイジェストを記録する", async () => {
    expect.hasAssertions();
    const measurement = await runVerification({
      cwd,
      checkedCommit: parseCommitId(revParseHead(cwd)),
      command: ["echo", "check-output"],
    });
    expect(measurement.exitCode).toBe(0);
    expect(measurement.executedCommand).toStrictEqual(["echo", "check-output"]);
    // stdout + stderr の連結に対する SHA-256（echo は末尾改行を含む）。
    const expectedDigest = crypto.createHash("sha256").update("check-output\n").digest("hex");
    expect(measurement.outputDigest).toBe(expectedDigest);
  });

  it("失敗した検証は非ゼロの exitCode をそのまま記録する", async () => {
    expect.hasAssertions();
    const measurement = await runVerification({
      cwd,
      checkedCommit: parseCommitId(revParseHead(cwd)),
      command: ["node", "-e", `process.exit(${FAILURE_EXIT_CODE})`],
    });
    expect(measurement.exitCode).toBe(FAILURE_EXIT_CODE);
  });

  it("シグナルで終了した検証プロセスは証跡にできず型付きエラーになる", async () => {
    expect.hasAssertions();
    await expect(
      runVerification({
        cwd,
        checkedCommit: parseCommitId(revParseHead(cwd)),
        command: ["/bin/sh", "-c", "kill -TERM $$"],
      }),
    ).rejects.toThrow(VerificationProcessError);
  });
});

describe("runVerification の既定コマンド", () => {
  it("既定のコマンドは mise run check である", () => {
    expect.hasAssertions();
    expect(DEFAULT_VERIFICATION_COMMAND).toStrictEqual(["mise", "run", "check"]);
  });
});

describe(miseRunCheckEvidence, () => {
  let parentDir: string;
  let cwd: string;

  beforeEach(async () => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-verify-test-"));
    cwd = await createGitRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("既定コマンド（stub した mise run check）の実行結果を SuccessfulCheck 証跡にできる", async () => {
    expect.hasAssertions();
    const binDir = path.join(parentDir, "bin");
    const { measurement, evidence } = await evidenceFromStubMise(
      binDir,
      cwd,
      'printf "stub check ok"\nexit 0',
    );
    if (evidence.exitCode !== 0) {
      throw new Error("成功スタブなのに FailedCheck になった");
    }
    const expectedDigest = crypto.createHash("sha256").update("stub check ok").digest("hex");
    // graph パッケージの SuccessfulCheck の形そのもの（command は literal）であること。
    expect(evidence).toStrictEqual({
      command: "mise run check",
      checkedCommit: evidence.checkedCommit,
      exitCode: 0,
      outputDigest: expectedDigest,
      finishedAt: measurement.finishedAt,
    });
  });

  it("非ゼロ終了の mise run check は FailedCheck 証跡になる", async () => {
    expect.hasAssertions();
    const binDir = path.join(parentDir, "bin");
    const { evidence } = await evidenceFromStubMise(binDir, cwd, 'echo "check failed" >&2\nexit 2');
    if (evidence.exitCode === 0) {
      throw new Error("失敗スタブなのに SuccessfulCheck になった");
    }
    expect(evidence.command).toBe("mise run check");
    expect(evidence.outputDigest).toBe(
      crypto.createHash("sha256").update("check failed\n").digest("hex"),
    );
  });
});

describe("miseRunCheckEvidence: 既定コマンド以外の測定値", () => {
  let parentDir: string;
  let cwd: string;

  beforeEach(async () => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-git-verify-test-"));
    cwd = await createGitRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("mise run check 以外の実行結果は証跡にできない（証跡の command が嘘をつかない）", async () => {
    expect.hasAssertions();
    const measurement = await runVerification({
      cwd,
      checkedCommit: parseCommitId(revParseHead(cwd)),
      command: ["echo", "lightweight"],
    });
    expect(() => miseRunCheckEvidence(measurement)).toThrow(VerificationEvidenceError);
  });
});
