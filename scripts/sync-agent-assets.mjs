#!/usr/bin/env node
// エージェント資産の同期スクリプト（docs/plan/Template/20260807_template-design.md §7「skill」）。
//
// 正本は `.claude/skills/`。このスクリプトはそれを `.agents/skills/` へ複製する。
// 正本の向きが AGENTS.md（規範）と逆になる理由は同節を参照。
//
// サブコマンド:
//   sync  （引数省略時の既定）  正本から生成物を書き込み、孤立生成物を削除する
//   check                      期待される生成結果をバイト単位で突合し、drift があれば非ゼロ終了する
//
// 3 つのガード:
//   1. 生成物の先頭にマーカーを書く
//   2. マーカーの無いファイルへの上書きを例外で拒否する（手書きファイルの誤消去を防ぐ）
//   3. 対応する正本が消えた孤立生成物を検出して削除する（削除対象はマーカー付きのものだけ）
//
// 「生成物の中身をどう組み立てるか」は generated-content.mjs、
// 「ディレクトリツリーの走査・削除」は file-tree.mjs に分けている
// （design doc 原則7: 概念単位で分ける。1 ファイルに吹き溜まらせない）。

import { buildGeneratedContent, hasMarker } from "./sync-agent-assets/generated-content.mjs";
import {
  listFilesRecursive,
  readOrNull,
  removeEmptyDirsUnder,
} from "./sync-agent-assets/file-tree.mjs";
import { promises as fs } from "node:fs";
import path from "node:path";

const scriptDir = import.meta.dirname;
const repoRoot = path.resolve(scriptDir, "..");

const SOURCE_DIR = path.join(repoRoot, ".claude", "skills");
const DEST_DIR = path.join(repoRoot, ".agents", "skills");

/** @returns {Promise<Map<string, string>>} */
async function computeExpected() {
  const sourceFiles = await listFilesRecursive(SOURCE_DIR);
  if (sourceFiles.length === 0) {
    console.warn(`警告: 正本 ${path.relative(repoRoot, SOURCE_DIR)} にファイルが見つかりません。`);
  }

  const expected = new Map();
  await Promise.all(
    sourceFiles.map(async (relPath) => {
      const sourceContent = await fs.readFile(path.join(SOURCE_DIR, relPath), "utf-8");
      expected.set(relPath, buildGeneratedContent(relPath, sourceContent));
    }),
  );
  return expected;
}

/**
 * guard 2: マーカーの無い既存ファイルへの上書きを拒否する。
 * @param {Map<string, string>} expected
 */
async function findBlockedPaths(expected) {
  const checks = await Promise.all(
    [...expected.keys()].map(async (relPath) => {
      const existing = await readOrNull(path.join(DEST_DIR, relPath));
      const blocked = existing !== null && !hasMarker(existing);
      return { relPath, blocked };
    }),
  );
  return checks.filter((entry) => entry.blocked).map((entry) => entry.relPath);
}

/** @param {string[]} blocked */
function assertNotBlocked(blocked) {
  if (blocked.length === 0) {
    return;
  }
  throw new Error(
    [
      "同期先に生成物マーカーの無いファイルが存在するため、上書きを拒否しました:",
      ...blocked.map((relPath) => ` - .agents/skills/${relPath}`),
      "手書きファイルの可能性があります。内容を確認し、生成物でないなら .agents/skills/ 以外へ移動してください。",
    ].join("\n"),
  );
}

/**
 * 期待される内容を書き込む（差分が無いファイルは書き込みをスキップする）。
 * @param {Map<string, string>} expected
 */
async function writeExpectedFiles(expected) {
  const wroteFlags = await Promise.all(
    [...expected.entries()].map(async ([relPath, content]) => {
      const destPath = path.join(DEST_DIR, relPath);
      const existing = await readOrNull(destPath);
      if (existing === content) {
        return false;
      }
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, content, "utf-8");
      return true;
    }),
  );
  return wroteFlags.filter(Boolean).length;
}

/**
 * guard 3: 正本が消えた孤立生成物を削除する（マーカー付きのものだけ）。
 * @param {Map<string, string>} expected
 */
async function removeOrphanedFiles(expected) {
  const actualFiles = await listFilesRecursive(DEST_DIR);
  const orphanCandidates = actualFiles.filter((relPath) => !expected.has(relPath));
  const removedFlags = await Promise.all(
    orphanCandidates.map(async (relPath) => {
      const destPath = path.join(DEST_DIR, relPath);
      const content = await fs.readFile(destPath, "utf-8");
      if (!hasMarker(content)) {
        return false;
      }
      await fs.rm(destPath);
      console.log(`削除（孤立生成物）: .agents/skills/${relPath}`);
      return true;
    }),
  );
  return removedFlags.filter(Boolean).length;
}

async function runSync() {
  const expected = await computeExpected();

  const blocked = await findBlockedPaths(expected);
  assertNotBlocked(blocked);

  const written = await writeExpectedFiles(expected);
  const removed = await removeOrphanedFiles(expected);
  await removeEmptyDirsUnder(DEST_DIR, DEST_DIR);

  console.log(
    `同期完了: 正本 ${expected.size} 件中 ${written} 件を書き込み、孤立生成物 ${removed} 件を削除しました。`,
  );
}

/** @param {Map<string, string>} expected */
async function checkMissingOrDrifted(expected) {
  const results = await Promise.all(
    [...expected.entries()].map(async ([relPath, content]) => {
      const existing = await readOrNull(path.join(DEST_DIR, relPath));
      if (existing === null) {
        return `欠落: .agents/skills/${relPath} が存在しません（mise run sync:agents で生成してください）`;
      }
      if (existing !== content) {
        return `不一致: .agents/skills/${relPath} が正本と一致しません（mise run sync:agents で再生成してください）`;
      }
      return null;
    }),
  );
  return results.filter((issue) => issue !== null);
}

/**
 * 正本に対応が無い残り: マーカー付きなら孤立生成物、マーカー無しなら想定外の手書きファイル。
 * @param {Map<string, string>} expected
 * @param {string[]} actualFiles
 */
async function checkUnexpectedFiles(expected, actualFiles) {
  const remaining = actualFiles.filter((relPath) => !expected.has(relPath));
  return await Promise.all(
    remaining.map(async (relPath) => {
      const content = await fs.readFile(path.join(DEST_DIR, relPath), "utf-8");
      if (hasMarker(content)) {
        return `孤立: .agents/skills/${relPath} に対応する正本 .claude/skills/${relPath} がありません（mise run sync:agents で削除してください）`;
      }
      return `想定外: .agents/skills/${relPath} は生成物マーカーが無く、正本にも対応がありません（手書きファイルが混入している可能性があります）`;
    }),
  );
}

/** @param {string[]} issues */
function reportIssues(issues) {
  if (issues.length === 0) {
    return false;
  }
  console.error("agent 資産の同期に drift があります:");
  for (const issue of issues) {
    console.error(` - ${issue}`);
  }
  return true;
}

async function runCheck() {
  const expected = await computeExpected();
  const actualFiles = await listFilesRecursive(DEST_DIR);

  const missingOrDrifted = await checkMissingOrDrifted(expected);
  const unexpected = await checkUnexpectedFiles(expected, actualFiles);
  const issues = [...missingOrDrifted, ...unexpected];

  if (reportIssues(issues)) {
    process.exitCode = 1;
    return;
  }

  console.log(`drift なし（${expected.size} 件を検証しました）。`);
}

/** @param {string} command */
async function dispatch(command) {
  if (command === "sync") {
    await runSync();
    return;
  }
  if (command === "check") {
    await runCheck();
    return;
  }
  throw new Error(`未知のサブコマンドです: ${command}（sync または check のみ対応）`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    throw new Error(`引数が多すぎます: ${args.join(" ")}（sync または check のみ対応）`);
  }

  const command = args[0] ?? "sync";
  await dispatch(command);
}

/** @param {unknown} error */
function describeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return error;
}

try {
  await main();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
