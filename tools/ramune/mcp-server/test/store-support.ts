// GraphStore のテスト共通ヘルパ。一時リポジトリルートの作成と、永続化ファイルの
// 読み書き（raw テキストとして）を担う。store はドメイン操作を持たないため、
// ここでもグラフの組み立ては @webapp-blueprint/ramune-graph の公開 API / リテラルで行う。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GRAPH_PATH_SEGMENTS = [".ramune", "graph.json"];

export function makeRepositoryRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ramune-store-test-"));
}

export function graphPathOf(repositoryRoot: string): string {
  return path.join(repositoryRoot, ...GRAPH_PATH_SEGMENTS);
}

export function readPersistedText(repositoryRoot: string): string {
  return fs.readFileSync(graphPathOf(repositoryRoot), "utf-8");
}

export function writeRawGraph(repositoryRoot: string, text: string): void {
  fs.mkdirSync(path.join(repositoryRoot, ".ramune"), { recursive: true });
  fs.writeFileSync(graphPathOf(repositoryRoot), text);
}

/** v1 形式のファイル（このサーバーが扱わない旧バージョン）。 */
export const LEGACY_V1_RAW = JSON.stringify({
  version: 1,
  goal: "legacy goal",
  session: { active: false },
  nodes: [],
});

/**
 * promise が reject した場合の理由を捕まえる（成功時は undefined）。
 * store が投げるドメインエラーは全て Error を継承するため、reject 理由が
 * Error でない場合はテストの前提が崩れているとみなしてそのまま投げ直す。
 */
export async function captureRejection(promise: Promise<unknown>): Promise<Error | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error: unknown) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return error;
  }
}
