import {
  type BootstrapSource,
  collectReachableSources,
  INSTALL_TASK_NAME,
  checkBootstrapSourcesResolveWithoutInstall,
  checkMcpLaunchTasksDependOnInstall,
  extractImportSpecifiers,
  extractMiseTaskLaunches,
  parseMcpConfig,
  requiresNodeModulesResolution,
} from "./harness-bootstrap.check.ts";
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extractTaskDepends } from "../manifest-parsing/mise-tasks.ts";
import path from "node:path";

vi.setConfig({ testTimeout: 5000 });

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const HOOKS_SOURCE_DIR = path.join(REPO_ROOT, "tools/ramune/hooks/src");

/** collectReachableSources に注入する読み取り器（fs を純粋関数の側に持ち込まないため）。 */
function readSourceOrUndefined(filePath: string): string | undefined {
  return existsSync(filePath) ? readFileSync(filePath, "utf-8") : undefined;
}

const MCP_JSON_SAMPLE = JSON.stringify({
  mcpServers: {
    "blume-docs": { type: "http", url: "http://localhost:4321/mcp" },
    ramune: { type: "stdio", command: "mise", args: ["run", "mcp:ramune"] },
  },
});

/** hooks/src 直下の .ts を、到達解析の起点として列挙する。 */
function hookEntryPaths(): string[] {
  return readdirSync(HOOKS_SOURCE_DIR)
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => path.join(HOOKS_SOURCE_DIR, entry));
}

describe(extractMiseTaskLaunches, () => {
  it("mise task を起動する stdio エントリだけを取り出す（http エントリは対象外）", () => {
    expect.hasAssertions();
    expect(extractMiseTaskLaunches(MCP_JSON_SAMPLE)).toStrictEqual([
      { server: "ramune", task: "mcp:ramune" },
    ]);
  });

  it("mise 以外のコマンドで起動するエントリは対象外", () => {
    expect.hasAssertions();
    const mcpJson = JSON.stringify({
      mcpServers: { other: { command: "npx", args: ["run", "something"] } },
    });
    expect(extractMiseTaskLaunches(mcpJson)).toStrictEqual([]);
  });

  it("mcpServers が無ければ空配列を返す", () => {
    expect.hasAssertions();
    expect(extractMiseTaskLaunches("{}")).toStrictEqual([]);
  });
});

describe(checkMcpLaunchTasksDependOnInstall, () => {
  it("depends に install があれば違反ゼロ", () => {
    expect.hasAssertions();
    expect(
      checkMcpLaunchTasksDependOnInstall([
        { server: "ramune", task: "mcp:ramune", depends: [INSTALL_TASK_NAME] },
      ]),
    ).toStrictEqual([]);
  });

  it("depends に install が無ければ、サーバ名と task 名を含めて報告する", () => {
    expect.hasAssertions();
    const violations = checkMcpLaunchTasksDependOnInstall([
      { server: "ramune", task: "mcp:ramune", depends: [] },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("mcp:ramune");
  });
});

describe(requiresNodeModulesResolution, () => {
  it("相対パスと node: 組み込みは解決を必要としない", () => {
    expect.hasAssertions();
    expect(requiresNodeModulesResolution("./mode.ts")).toBe(false);
    expect(requiresNodeModulesResolution("../../graph/src/index.ts")).toBe(false);
    expect(requiresNodeModulesResolution("node:fs")).toBe(false);
  });

  it("パッケージ名（bare specifier）は解決を必要とする", () => {
    expect.hasAssertions();
    expect(requiresNodeModulesResolution("@webapp-blueprint/ramune-graph")).toBe(true);
    expect(requiresNodeModulesResolution("vitest")).toBe(true);
  });
});

describe(extractImportSpecifiers, () => {
  it("static import・export from・dynamic import() の指定子を取り出す", () => {
    expect.hasAssertions();
    const source = [
      'import fs from "node:fs";',
      'import { a } from "./a.ts";',
      'export { b } from "../b.ts";',
      'const c = await import("pkg-name");',
      'import "./side-effect.ts";',
    ].join("\n");
    expect(extractImportSpecifiers(source)).toStrictEqual([
      "node:fs",
      "./a.ts",
      "../b.ts",
      "pkg-name",
      "./side-effect.ts",
    ]);
  });
});

describe(checkBootstrapSourcesResolveWithoutInstall, () => {
  it("相対パスと node: だけなら違反ゼロ", () => {
    expect.hasAssertions();
    const sources: BootstrapSource[] = [
      { path: "mode.ts", specifiers: ["node:fs", "../../graph/src/index.ts"] },
    ];
    expect(checkBootstrapSourcesResolveWithoutInstall(sources)).toStrictEqual([]);
  });

  it("パッケージ名の import は、指定子を含めて報告する", () => {
    expect.hasAssertions();
    const sources: BootstrapSource[] = [
      { path: "mode.ts", specifiers: ["@webapp-blueprint/ramune-graph"] },
    ];
    const violations = checkBootstrapSourcesResolveWithoutInstall(sources);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("@webapp-blueprint/ramune-graph");
  });
});

describe("harness-bootstrap: 実リポジトリ", () => {
  const miseTomlText = readFileSync(path.join(REPO_ROOT, "mise.toml"), "utf-8");
  const mcpJsonText = readFileSync(path.join(REPO_ROOT, ".mcp.json"), "utf-8");
  const launches = extractMiseTaskLaunches(mcpJsonText);
  const serverNames = Object.keys(parseMcpConfig(mcpJsonText).mcpServers ?? {});

  it(".mcp.json が MCP サーバを 1 件も持たない状態で緑になってはいけない", () => {
    expect.hasAssertions();
    expect(serverNames.length).toBeGreaterThan(0);
  });

  it("stdio エントリが mise task を起動するなら、その task はすべて depends に install を持つ", () => {
    expect.hasAssertions();
    const tasks = launches.map((launch) => ({
      ...launch,
      depends: extractTaskDepends(miseTomlText, launch.task),
    }));
    expect(checkMcpLaunchTasksDependOnInstall(tasks)).toStrictEqual([]);
  });

  it("ramune サーバの起動経路 mcp:ramune:serve は depends に install を持つ", () => {
    expect.hasAssertions();
    // ADR 0013: transport が HTTP になり、ramune エントリは .mcp.json から spawn
    // されなくなった。ADR 0004 の bootstrap 保証は消えたのではなく担い手が
    // serve task へ移ったので、そちら側で直接検査する（検査対象 0 件での
    // 黙って緑を防ぐのが、この検査の目的）。
    expect(extractTaskDepends(miseTomlText, "mcp:ramune:serve")).toContain(INSTALL_TASK_NAME);
  });

  it("install task が mise.toml に実在する（depends の指す先が空でない）", () => {
    expect.hasAssertions();
    expect(miseTomlText).toContain(`[tasks.${INSTALL_TASK_NAME}]`);
  });
});

describe("harness-bootstrap: hook の到達先まで含めた import 検査", () => {
  it("PreToolUse hook のソースは node_modules 解決を必要とする import を持たない", () => {
    expect.hasAssertions();
    // 直接の import だけでなく、相対 import で到達するファイルまで辿る。
    // hook が相対 import する tools/ramune/graph/src/persisted-graph.ts に依存が
    // 増えても hook は落ちるため、そこまで検査対象にしないと穴が残る
    // （ADR 0004 / collectReachableSources のコメント参照）。
    const entryPaths = hookEntryPaths();
    const sources = collectReachableSources(entryPaths, readSourceOrUndefined).map((source) => ({
      path: path.relative(REPO_ROOT, source.path),
      specifiers: source.specifiers,
    }));

    // hooks/src の外まで到達していることを確かめる。到達しなくなったら
    // （hook が graph を参照しなくなった等）この検査は直接 import だけを見る
    // 元の強度に戻っているので、気づけるようにしておく。
    expect(sources.length).toBeGreaterThan(entryPaths.length);
    expect(checkBootstrapSourcesResolveWithoutInstall(sources)).toStrictEqual([]);
  });

  it("hook が相対 import で到達する先に依存が増えたら落とせる", () => {
    expect.hasAssertions();
    // 実リポジトリの構造を使い、到達先のソースだけを差し替えて壊す
    // （実装が消えても静かに緑にならないよう、fixture ではなく実ファイルを起点にする）。
    const entryPaths = hookEntryPaths();
    const injected = (filePath: string): string | undefined => {
      const text = readSourceOrUndefined(filePath);
      if (text === undefined) {
        return undefined;
      }
      return filePath.endsWith("persisted-graph.ts") ? `import { z } from "zod";\n${text}` : text;
    };

    const violations = checkBootstrapSourcesResolveWithoutInstall(
      collectReachableSources(entryPaths, injected),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('import "zod"');
  });
});
