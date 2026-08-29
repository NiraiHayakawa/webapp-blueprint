/**
 * ハーネス（ramune・docs MCP）の起動経路が、`node_modules` の有無で silent に
 * 壊れないことの検証（原則2 fail-fast / 原則4 規約は機械で縛る。ADR 0004）。
 *
 * 背景: `node_modules` が無い worktree で
 * Claude Code を開くと、`.mcp.json` の ramune エントリが起動する
 * `mise run mcp:ramune` が依存解決に失敗して落ち、そのセッションでは
 * `mcp__ramune__*` ツールが最初から存在しない状態になる。エージェント側から
 * 見えるのは「ツールが無い」という結果だけで、原因は何も報告されない。
 * 同じ理由で PreToolUse hook（`tools/ramune/hooks/src/`）も import 時に落ち、
 * exit code 1（Claude Code の扱いは non-blocking error）となってツール呼び出しを
 * 素通りさせる = ramune モードの fail-closed 強制がすり抜ける。
 *
 * どちらも「壊れていることが観測できないまま動く」形の失敗であり、散文の注意書きでは
 * 再発を止められない。次の 2 つを機械で縛る。
 *
 * ① `.mcp.json` が mise task 経由で起動する MCP サーバは、その task が
 *    `depends` に `install` を持つ（起動経路が自分の前提を自分で満たす）。
 *    ADR 0013 で ramune の transport が HTTP になり、ramune エントリは spawn
 *    されなくなったため、保証の担い手は serve task（`mcp:ramune:serve`）へ
 *    移っている。実リポジトリに対する検査は test 側で担い手ごとに行う
 * ② PreToolUse hook のソース（`tools/ramune/hooks/src/`）は `node_modules` の
 *    解決を必要とする import を持たない（hook は install より前に発火しうる）
 */

import type { PolicyViolation } from "../violation.ts";
import path from "node:path";

/** ①で存在を要求する、依存インストール task の名前。 */
const INSTALL_TASK_NAME = "install";

/** `.mcp.json` の 1 エントリが起動する mise task。 */
interface MiseTaskLaunch {
  readonly server: string;
  readonly task: string;
}

/** ①の検証対象: `.mcp.json` 由来の起動 task と、mise.toml 側のその task の `depends`。 */
interface McpLaunchTask extends MiseTaskLaunch {
  readonly depends: readonly string[];
}

/** ②の検証対象: hook のソース 1 ファイルと、そこに書かれた import 指定子。 */
interface BootstrapSource {
  readonly path: string;
  readonly specifiers: readonly string[];
}

/**
 * `.mcp.json` の 1 サーバエントリのうち、このモジュールが読む範囲だけの契約。
 * stdio エントリは `command` / `args` を持ち、http エントリ（blume-docs）は
 * どちらも持たない — その差がそのまま「起動するか否か」の判定になる。
 */
interface McpServerDefinition {
  readonly command?: string;
  readonly args?: readonly string[];
}

/** `.mcp.json` のうち、このモジュールが読む範囲だけの契約。 */
interface McpConfig {
  readonly mcpServers?: Readonly<Record<string, McpServerDefinition>>;
}

/**
 * `.mcp.json` のテキストを `McpConfig` に確定させる I/O 境界。
 *
 * スキーマライブラリ（zod）は使えない: tests/policy は pnpm workspace の
 * パッケージではなく（pnpm-workspace.yaml 参照）、依存を宣言する package.json
 * を持たない。mise-tasks.ts が汎用 TOML パーサを諦めたのと同じ制約。
 */
function parseMcpConfig(mcpJsonText: string): McpConfig {
  const parsed: unknown = JSON.parse(mcpJsonText);
  if (!(parsed instanceof Object) || Array.isArray(parsed)) {
    throw new Error(".mcp.json のトップレベルはオブジェクトである必要があります。");
  }
  // 上の絞り込みで `parsed` は `Object` になっており、全フィールドが任意の
  // `McpConfig` へそのまま代入できる（型アサーションは要らない）。各エントリの
  // 形は Claude Code が読む `.mcp.json` の固定スキーマであり、書き手は本
  // リポジトリ自身。形が崩れて起動エントリが取れなくなれば、
  // harness-bootstrap.test.ts の実リポジトリケース（launches が 0 件で緑に
  // ならないこと）が落ちる。
  return parsed;
}

/** `mise run <task>` の引数列から task 名を取り出す。`run` が無ければ undefined。 */
function taskNameFromMiseArgs(args: readonly string[]): string | undefined {
  const runIndex = args.indexOf("run");
  return runIndex === -1 ? undefined : args[runIndex + 1];
}

/** `.mcp.json` の 1 エントリが起動する mise task。mise 以外で起動するものは空配列。 */
function launchOfServer(server: string, definition: McpServerDefinition): MiseTaskLaunch[] {
  if (definition.command !== "mise") {
    return [];
  }
  const task = taskNameFromMiseArgs(definition.args ?? []);
  return task === undefined ? [] : [{ server, task }];
}

/**
 * `.mcp.json` の中から「mise task を起動する stdio サーバ」だけを取り出す。
 * http transport のエントリ（blume-docs）は別プロセスを指すだけで起動しないため対象外。
 */
function extractMiseTaskLaunches(mcpJsonText: string): MiseTaskLaunch[] {
  const { mcpServers } = parseMcpConfig(mcpJsonText);
  return Object.entries(mcpServers ?? {}).flatMap(([server, definition]) =>
    launchOfServer(server, definition),
  );
}

/** ①: MCP を起動する mise task が `depends` に `install` を持つこと。 */
function checkMcpLaunchTasksDependOnInstall(tasks: readonly McpLaunchTask[]): PolicyViolation[] {
  return tasks
    .filter((entry) => !entry.depends.includes(INSTALL_TASK_NAME))
    .map((entry) => ({
      source: `.mcp.json:${entry.server}`,
      message:
        `MCP サーバ "${entry.server}" が起動する mise task "${entry.task}" の depends に ` +
        `"${INSTALL_TASK_NAME}" が無い。node_modules が無い worktree では起動時に依存解決で落ち、` +
        `そのセッションではツールが存在しないまま静かに進む`,
    }));
}

/** 指定子が `node_modules` の解決を必要とするか（相対パスと `node:` 組み込み以外は必要とする）。 */
function requiresNodeModulesResolution(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return false;
  }
  return !specifier.startsWith("node:");
}

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](?<specifier>[^"']+)["']/gu;

/** ソーステキストから import / export ... from / dynamic import() の指定子を取り出す。 */
function extractImportSpecifiers(sourceText: string): string[] {
  return [...sourceText.matchAll(IMPORT_SPECIFIER)]
    .map((match) => match.groups?.specifier)
    .filter((specifier): specifier is string => specifier !== undefined);
}

/**
 * 読めなかったソースを違反として報告するための擬似指定子。
 * `requiresNodeModulesResolution` が true を返す形（相対でも `node:` でもない）
 * にしてあるので、既存の検査にそのまま乗る。
 */
const UNREADABLE_SOURCE_SPECIFIER = "<解決できない相対 import>";

/**
 * 相対指定子を、import しているファイルからの絶対パスに解決する。
 * `node:path` は文字列計算のみで I/O を伴わないため、純粋関数の側に置く。
 */
function resolveRelativeSpecifier(importerPath: string, specifier: string): string {
  return path.resolve(path.dirname(importerPath), specifier);
}

/** 1 ファイルを BootstrapSource に写す。読めなければ違反として表現する。 */
function readSourceEntry(
  filePath: string,
  readSource: (filePath: string) => string | undefined,
): BootstrapSource {
  const sourceText = readSource(filePath);
  if (sourceText === undefined) {
    return { path: filePath, specifiers: [UNREADABLE_SOURCE_SPECIFIER] };
  }
  return { path: filePath, specifiers: extractImportSpecifiers(sourceText) };
}

/** そのソースが相対 import で指している先を、絶対パスにして返す。 */
function relativeImportTargets(source: BootstrapSource): string[] {
  return source.specifiers
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => resolveRelativeSpecifier(source.path, specifier));
}

/**
 * hook のエントリから相対 import を再帰的に辿り、到達するソースをすべて集める。
 *
 * 直接の指定子だけを見ていた時期があり、そこには穴があった（2026-08-18 に発見）:
 * `mode.ts` が相対 import する `tools/ramune/graph/src/persisted-graph.ts` が
 * `node_modules` を要する依存を増やしても、この検査は緑のまま通る。hook は
 * install より前に発火しうるので、これは「fail-closed の強制が静かに開く」という
 * ADR 0004 が防ごうとした事故そのものに戻る経路になる。当時 persisted-graph.ts の
 * 依存ゼロを保証していたのはファイル冒頭のコメントだけだった（原則4「規約は機械で
 * 縛る。散文は最後の手段」の対象）。
 *
 * fs を持ち込まないため、ソース本文の取得は `readSource` の注入で受ける
 * （このファイルの他の関数が純粋関数に留まっているのと同じ設計）。解決できない
 * 相対 import は**違反として報告する**: 検査対象から静かに落ちるより、解決器の
 * 不足として気づける方がよい。
 */
function collectReachableSources(
  entryPaths: readonly string[],
  readSource: (filePath: string) => string | undefined,
): BootstrapSource[] {
  const reached = new Map<string, BootstrapSource>();
  const queue = [...entryPaths];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (filePath === undefined || reached.has(filePath)) {
      continue;
    }
    const source = readSourceEntry(filePath, readSource);
    reached.set(filePath, source);
    queue.push(...relativeImportTargets(source));
  }

  return [...reached.values()];
}

/** ②: hook のソースが `node_modules` 解決を必要とする import を持たないこと。 */
function checkBootstrapSourcesResolveWithoutInstall(
  sources: readonly BootstrapSource[],
): PolicyViolation[] {
  return sources.flatMap((source) =>
    source.specifiers.filter(requiresNodeModulesResolution).map((specifier) => ({
      source: source.path,
      message:
        `import "${specifier}" は node_modules の解決を必要とする。PreToolUse hook は ` +
        `install より前に発火しうるため、依存が無いと import 時に落ちて fail-open する` +
        `（相対パスで直接 import する）`,
    })),
  );
}

export {
  parseMcpConfig,
  collectReachableSources,
  extractMiseTaskLaunches,
  checkMcpLaunchTasksDependOnInstall,
  requiresNodeModulesResolution,
  extractImportSpecifiers,
  checkBootstrapSourcesResolveWithoutInstall,
  INSTALL_TASK_NAME,
};
export type { MiseTaskLaunch, McpLaunchTask, BootstrapSource };
