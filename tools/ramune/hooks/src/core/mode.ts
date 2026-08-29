/**
 * ramune モード（Orchestrator / Planner / Worker / Integrator の役割を
 * fail-closed で機械強制する状態）に明示的に入っているかどうかを判定する。
 */
import fs from "node:fs";
import path from "node:path";
import { GRAPH_FILE_RELATIVE_PATH } from "../../../graph/src/persisted-graph.ts";
import { resolveCanonicalRepositoryRoot } from "./locator.ts";

/** 設計正本 §2 の `GraphSession` の state 判別子。 */
type SessionState = "active" | "inactive";

/**
 * グラフファイルの内容から ramune モードの稼働/非稼働を判定できないときに投げる。
 */
export class RamuneModeIndeterminateError extends Error {
  constructor(filePath: string, reason: string) {
    super(
      `${filePath} から ramune モードの稼働/非稼働を判定できません（${reason}）。` +
        "ファイルの内容を確認するか、ramune_start でグラフを作り直してください。",
    );
    this.name = "RamuneModeIndeterminateError";
  }
}

function readGraphFileContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new RamuneModeIndeterminateError(filePath, `読み取りに失敗しました: ${String(error)}`);
  }
}

interface ParsedGraphRoot {
  readonly session?: unknown;
}

function sessionStateOf(graphRoot: ParsedGraphRoot): SessionState | undefined {
  const session: unknown = graphRoot.session;
  if (!(session instanceof Object)) {
    return undefined;
  }
  if (!("state" in session)) {
    return undefined;
  }

  const state: unknown = session.state;
  if (state === "active" || state === "inactive") {
    return state;
  }
  return undefined;
}

function parseSessionState(rawContent: string, filePath: string): SessionState | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new RamuneModeIndeterminateError(filePath, `JSON として解析できません: ${String(error)}`);
  }

  if (!(parsed instanceof Object)) {
    return undefined;
  }

  return sessionStateOf(parsed);
}

function readGraphSessionState(filePath: string): SessionState | undefined {
  return parseSessionState(readGraphFileContent(filePath), filePath);
}

/**
 * セッションの作業ディレクトリ（canonical リポジトリ内でもどの linked worktree 内
 * でもよい）から ramune モードの稼働/非稼働を判定する。
 *
 * - canonical リポジトリの `.ramune/graph.json` が無い → 非稼働（false）
 * - `session.state` が `"active"` → 稼働中（true）
 * - `session.state` が `"inactive"` → 非稼働（false）
 * - 判定不能 → `RamuneModeIndeterminateError`
 * - canonical リポジトリを解決できない → `GraphLocatorError`
 */
export function isRamuneModeActive(sessionWorkingDirectory: string): boolean {
  const canonicalRepositoryRoot = resolveCanonicalRepositoryRoot(sessionWorkingDirectory);
  const filePath = path.join(canonicalRepositoryRoot, GRAPH_FILE_RELATIVE_PATH);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  const state = readGraphSessionState(filePath);
  if (state === undefined) {
    throw new RamuneModeIndeterminateError(
      filePath,
      'session.state を "active" / "inactive" として読めません',
    );
  }

  return state === "active";
}
