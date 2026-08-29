#!/usr/bin/env node
// `mise run ramune:status` の実体。.ramune/graph.json を読み取り、ramune モードの
// 稼働状況を人間向けに表示する読み取り専用コマンド(書き込みは一切行わない)。
//
// GraphStore をそのまま使わない理由: GraphStore.load()/loadOrCreate() は
// 「ファイルが無ければ新規作成する」経路を持つが、status はグラフを一切
// 変更してはいけない。既存の書き込み経路を誤って踏まないよう、ファイルの
// 有無とその中身を直接確認する。
//
// main.ts と同じく process.cwd() をリポジトリルートとして扱う(mise task が
// この mise.toml のあるディレクトリを cwd にするため。main.ts のコメント参照)。
//
// import/no-nodejs-modules: mcp-server/src/main.ts のコメント参照
// (apps/api と同じ扱いで、ディレクトリ一括除外ではなく行単位で抑制する)。
// oxlint-disable-next-line import/no-nodejs-modules -- 上のコメント参照。
import fs from "node:fs";
// oxlint-disable-next-line import/no-nodejs-modules -- 上のコメント参照。
import path from "node:path";
import { z } from "zod";
import { GRAPH_FILE_RELATIVE_PATH, parseGraph, type GraphV2 } from "@webapp-blueprint/ramune-graph";

function resolveGraphFilePath(): string {
  return path.join(process.cwd(), GRAPH_FILE_RELATIVE_PATH);
}

// eslint/no-console: main.ts の run() と同じ「CLI の観測可能な結果」であり、
// アプリケーションコードの debug 用 console.log とは種類が異なる。
// oxlint-disable-next-line eslint/no-console -- 上のコメント参照。
const print = console.log;

function printNotFound(filePath: string): void {
  print(`ramune: 非稼働(${filePath} が存在しない。ramune_start で開始できる)`);
}

function printIndeterminate(filePath: string): void {
  print(
    `ramune: 判定不能(${filePath} の内容が version / goal / nodes / session.state の形を満たさない)`,
  );
  process.exitCode = 1;
}

function printGraphSummary(graph: GraphV2): void {
  const active = graph.session.state === "active";
  print(`ramune: ${active ? "稼働中" : "非稼働"}`);
  if (active) {
    print(`runId: ${graph.session.runId}`);
    print(`epoch: ${graph.session.epoch}`);
  }
  print(`revision: ${graph.revision}`);
  print(`goal: ${graph.goal}`);
  print(`nodes: ${graph.nodes.length}`);
}

// 形が契約を満たさない場合だけ undefined を返す（呼び出し元が「判定不能」として
// 表示し exitCode 1 にする。非稼働には丸めない）。JSON として壊れている場合の
// SyntaxError は run() の catch まで伝播させ、CLI の致命的エラーとして報告する。
// parseGraph の投げ分けについては store.ts の readGraphFromDisk のコメント参照。
function readGraphOrNull(filePath: string): GraphV2 | undefined {
  // oxlint-disable-next-line node/no-sync -- 単発の CLI コマンドであり非同期化する理由が無い。
  const rawContent = fs.readFileSync(filePath, "utf-8");
  try {
    return parseGraph(rawContent);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return undefined;
    }
    throw error;
  }
}

function main(): void {
  const filePath = resolveGraphFilePath();

  // oxlint-disable-next-line node/no-sync -- 上のコメント参照。
  if (!fs.existsSync(filePath)) {
    printNotFound(filePath);
    return;
  }

  const graph = readGraphOrNull(filePath);
  if (graph === undefined) {
    printIndeterminate(filePath);
    return;
  }

  printGraphSummary(graph);
}

function run(): void {
  try {
    main();
  } catch (error) {
    // main.ts の run() と同じ形(CLI エントリポイントの致命的エラー報告)。
    // oxlint-disable-next-line eslint/no-console -- 上のコメント参照。
    console.error(error);
    process.exitCode = 1;
  }
}

run();
