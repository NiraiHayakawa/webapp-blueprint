import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHook } from "../src/pre-tool-use.ts";
import type { RawPreToolUseInput } from "../src/role.ts";
import {
  createCanonicalRepo,
  createLinkedWorktree,
  v2GraphJson,
  writeGraphFile,
} from "./support/fake-repo.ts";
import { readDocumentedDenyReason } from "./support/deny-output.ts";

// `runHook` は ramune モード（mode.ts。ADR 0003「ramune モードの状態機構」）の
// ゲートと canonical graph locator（locator.ts。設計正本 §9）を踏んだエントリ
// ポイントで、`main()` が実際に呼ぶのはこちら。第2引数はセッションの作業
// ディレクトリであり、canonical リポジトリのルートでもどの worktree の中でもよい。
// `runPreToolUseHook`（role/policy を常に fail-closed で適用する。単体の振る舞いは
// pre-tool-use.test.ts が検証する）とは検証したい公開契約が異なるため、この
// ファイルに分離している。

function rawInput(overrides: RawPreToolUseInput = {}): string {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    ...overrides,
  });
}

// eslint/max-lines-per-function は関数の物理的な行範囲（内側の describe/it の
// 行も含む）を見るため、1つの親 describe に子 describe をネストしても親自身の
// 行数は減らない。そのため各グループは意図的に親でくくらず、兄弟の
// トップレベル describe に分けている（一時ディレクトリの setup/teardown は
// それぞれが個別に持つ）。稼働中のグラフの形は共通なのでモジュールスコープに置く。
const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-1", epoch: 0 });

describe("runHook: ramune モードの外側（グラフが無い / session.state が inactive）では判定を下さない", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-run-hook-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it(".ramune/graph.json が無いなら、Orchestrator の Edit 呼び出しも拒否せず空文字列を返す", () => {
    expect.hasAssertions();
    const output = runHook(rawInput({ tool_name: "Edit" }), repositoryRoot);
    expect(output).toBe("");
  });

  it("session.state が inactive なら、Orchestrator の Edit 呼び出しも拒否せず空文字列を返す", () => {
    expect.hasAssertions();
    writeGraphFile(repositoryRoot, v2GraphJson({ state: "inactive" }));
    const output = runHook(rawInput({ tool_name: "Edit" }), repositoryRoot);
    expect(output).toBe("");
  });

  it(".ramune/graph.json が無いなら、role が未知のサブエージェントでも拒否しない", () => {
    expect.hasAssertions();
    // モード外では role.ts の判定自体を経由しないため、ramune が知らない
    // agent_type でも deny にならないことを確認する（モード判定が
    // role/policy 判定より先に効くことの回帰テスト）。
    const output = runHook(
      rawInput({ tool_name: "Edit", agent_id: "a9", agent_type: "some-other-subagent" }),
      repositoryRoot,
    );
    expect(output).toBe("");
  });
});

describe("runHook: ramune モードの内側では canonical リポジトリ直下の呼び出しが role ベースで判定される", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-run-hook-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repositoryRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("session.state が active なら、Orchestrator の Edit 呼び出しは拒否される", () => {
    expect.hasAssertions();
    const output = runHook(rawInput({ tool_name: "Edit" }), repositoryRoot);
    const permissionDecisionReason = readDocumentedDenyReason(output);
    expect(permissionDecisionReason).toMatch(/worker/u);
  });

  it("session.state が active なら、Worker の Edit 呼び出しは拒否されない", () => {
    expect.hasAssertions();
    const output = runHook(
      rawInput({ tool_name: "Edit", agent_id: "a2", agent_type: "worker" }),
      repositoryRoot,
    );
    expect(output).toBe("");
  });
});

describe("runHook: 作業ディレクトリが linked worktree でも canonical graph の稼働判定が効く", () => {
  // 設計正本 §9 / §10 hard gate 2 の本体。グラフファイルは canonical 側にしか
  // 置かれない（worktree には無い）。cwd をリポジトリルートとして直接読む実装では
  // 「非稼働」と誤判定して強制がすり抜ける。canonical graph を解決して判定する
  // ことを契約として固定する。
  let parentDir: string;
  let repositoryRoot: string;
  let worktreeRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-run-hook-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
    worktreeRoot = createLinkedWorktree(repositoryRoot);
    writeGraphFile(repositoryRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("canonical 側で稼働中なら、worktree からの Orchestrator Edit 呼び出しは拒否される", () => {
    expect.hasAssertions();
    expect(fs.existsSync(path.join(worktreeRoot, ".ramune"))).toBe(false);
    const output = runHook(rawInput({ tool_name: "Edit" }), worktreeRoot);
    const permissionDecisionReason = readDocumentedDenyReason(output);
    expect(permissionDecisionReason).toMatch(/worker/u);
  });

  it("canonical 側で稼働中なら、worktree で作業する Worker の Edit 呼び出しは拒否されない", () => {
    expect.hasAssertions();
    const output = runHook(
      rawInput({ tool_name: "Edit", agent_id: "a2", agent_type: "worker" }),
      worktreeRoot,
    );
    expect(output).toBe("");
  });

  it("canonical 側で稼働中なら、worktree で作業する Integrator の統合ツール呼び出しは拒否されない", () => {
    expect.hasAssertions();
    const output = runHook(
      rawInput({
        tool_name: "mcp__ramune__ramune_advance_integration",
        agent_id: "a3",
        agent_type: "integrator",
      }),
      worktreeRoot,
    );
    expect(output).toBe("");
  });
});

describe("runHook: ramune モードの判定自体が失敗したら安全側に倒して拒否する", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-run-hook-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("グラフファイルが壊れているなら、role/policy 判定に進まず理由付きで拒否する", () => {
    expect.hasAssertions();
    writeGraphFile(repositoryRoot, "{ not valid json");
    const output = runHook(rawInput({ tool_name: "Edit" }), repositoryRoot);
    const permissionDecisionReason = readDocumentedDenyReason(output);
    expect(permissionDecisionReason).toMatch(/ramune_start/u);
  });
});

describe("runHook: canonical graph を解決できない作業ディレクトリは fail-closed で拒否する", () => {
  let plainDirectory: string;

  beforeEach(() => {
    // git リポジトリの形をしていない一時ディレクトリ。設計正本 §9 の
    // 「解決できなければ fail-closed で拒否」の契約。
    plainDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-run-hook-test-plain-"));
  });

  afterEach(() => {
    fs.rmSync(plainDirectory, { recursive: true, force: true });
  });

  it("親方向に .git が存在しない作業ディレクトリからの呼び出しは理由付きで拒否される", () => {
    expect.hasAssertions();
    const output = runHook(
      rawInput({
        tool_name: "mcp__ramune__ramune_read_graph",
        agent_id: "a1",
        agent_type: "planner",
      }),
      plainDirectory,
    );
    const permissionDecisionReason = readDocumentedDenyReason(output);
    expect(permissionDecisionReason).toMatch(/canonical/u);
  });
});
