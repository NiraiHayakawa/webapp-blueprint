#!/usr/bin/env node
// 原則11②「同期」チェックの実配線(docs/plan/Template/20260807_template-design.md
// §5「policy-as-test」/「正本の鮮度」/ §7「記憶レイヤー」)。
//
// 監査(2026-08-08)で発見した事実: checkSyncOnDiff
// (tests/policy/source-freshness/source-freshness.check.ts)自体は
// source-freshness.test.ts の手作り fixture(`new Set([...])`)からしか
// 呼ばれておらず、実際の git diff や実リポジトリの変更ファイル集合を
// 計算して渡す配線が CI・スクリプト・mise.toml のどこにも存在しなかった。
// このスクリプトがその配線を担う。
//
// 手順:
//   1. 環境変数 SOURCE_SYNC_BASE_SHA から base commit を得る(必須)
//   2. `git diff --name-only <base> HEAD` で変更ファイル集合を計算する
//   3. リポジトリ内の AGENTS.md 階層(tests/policy/ 配下の fixture を除く)を
//      実際に読み、各ファイルが参照するパス・mise task を抽出する
//   4. checkSyncOnDiff に渡し、違反があれば非ゼロ終了する
//
// fail-fast(原則2): SOURCE_SYNC_BASE_SHA が無い実行では、デフォルト値へ
// フォールバックしたり黙って「違反ゼロ」を返したりしない。base が定まらない
// 実行は「検査していない」のであって「合格した」のではないため、例外を
// raise して非ゼロ終了する。呼び出し元は .github/workflows/ci.yml の
// source-sync job(pull_request イベントでのみ実行し、
// `${{ github.event.pull_request.base.sha }}` を渡す)。
// ローカル実行やこのタスクを push イベントから呼ぶことは意図的にサポート
// しない(base の意味が「同一 PR 内」に対応しないため)。同じ理由で
// mise.toml の [tasks.check].depends にもこのタスクを含めない
// (`test:e2e` が check の外にあるのと同型の判断。§4 末尾参照)。
//
// 既知の限界(直せなかったこと。report に明記する):
// checkSyncOnDiff は changedFiles との「完全一致」でしか参照先を判定しない。
// AGENTS.md 階層が実際にバックティックで参照している値の大半
// (`.claude/skills/` `contract/` `apps/web` `docs/` 等)はディレクトリで
// あり、`git diff --name-only` が返すのは個々のファイルパスなので、
// ディレクトリ配下のどのファイルが変わっても文字列としては一致せず
// この検査は発火しない(例: `.mcp.json` のような単一ファイル参照でのみ
// 確実に発火する)。checkSyncOnDiff 自体のマッチング方式を変えることは
// このタスクの範囲外("ロジックを作り直さない")と理解しているため、ここでは
// 直さずに配線のみ行い、この限界を report に明記する。

import {
  buildReferencingDocs,
  checkSyncOnDiff,
  parseChangedFilesOutput,
} from "../tests/policy/source-freshness/source-freshness.check.ts";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { walkFiles } from "../tools/architecture/src/file-walk.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TESTS_POLICY_PREFIX = `${path.sep}tests${path.sep}policy${path.sep}`;

/** @param {NodeJS.ProcessEnv} env */
function resolveBaseSha(env) {
  const value = env.SOURCE_SYNC_BASE_SHA;
  if (value === undefined || value.trim() === "") {
    throw new Error(
      "環境変数 SOURCE_SYNC_BASE_SHA が未設定です。正本の同期チェック(原則11②)は " +
        "pull_request の base.sha が無いと実行できません。ローカル実行や push イベント " +
        "からこのスクリプトを直接呼ぶことは意図的にサポートしていません " +
        "(黙って違反ゼロを返す経路は作っていません)。",
    );
  }
  return value.trim();
}

/** @param {string} baseSha */
function computeChangedFiles(baseSha) {
  const output = execFileSync("git", ["diff", "--name-only", baseSha, "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  return parseChangedFilesOutput(output);
}

/**
 * 実リポジトリの AGENTS.md 階層を読み、RawDoc[] にする。
 * source-freshness.test.ts の「実リポジトリ」describe ブロックと同じ
 * 対象選定(AGENTS.md のみ・tests/policy/ 配下の fixture を除く)を使う。
 */
function loadRealAgentsMdDocs() {
  const agentsMdPaths = walkFiles(REPO_ROOT).filter((filePath) => {
    if (filePath.includes(TESTS_POLICY_PREFIX)) {
      // 自己テスト用 fixture を除く
      return false;
    }
    return path.basename(filePath) === "AGENTS.md";
  });

  return agentsMdPaths.map((absolutePath) => ({
    docPath: path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/"),
    text: readFileSync(absolutePath, "utf-8"),
  }));
}

/** @param {{ source: string; message: string }[]} violations */
function reportViolations(violations) {
  console.error(
    `正本の同期チェック(原則11②)で ${violations.length} 件の違反: 同一 PR 内で参照先が変わったのに正本が変更されていません。`,
  );
  for (const violation of violations) {
    console.error(` - ${violation.source}: ${violation.message}`);
  }
}

function main() {
  const baseSha = resolveBaseSha(process.env);
  const changedFiles = computeChangedFiles(baseSha);
  const referencingDocs = buildReferencingDocs(loadRealAgentsMdDocs());
  const violations = checkSyncOnDiff(changedFiles, referencingDocs);

  if (violations.length > 0) {
    reportViolations(violations);
    process.exitCode = 1;
    return;
  }

  console.log(
    `同期チェック: 違反なし(base=${baseSha} / 変更ファイル ${changedFiles.size} 件 / 検査した正本 ${referencingDocs.length} 件)。`,
  );
}

/** @param {unknown} error */
function describeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return error;
}

try {
  main();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
