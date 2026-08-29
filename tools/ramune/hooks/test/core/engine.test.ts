import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateHookRequest } from "../../src/core/engine.ts";
import type { ActionType } from "../../src/core/actions.ts";
import {
  createCanonicalRepo,
  createLinkedWorktree,
  v2GraphJson,
  writeGraphFile,
} from "../support/fake-repo.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-1", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });

describe("evaluateHookRequest: 非稼働セッション時の振る舞い（全操作許可）", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-engine-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it(".ramune/graph.json が存在しない場合は全操作に対して allow を返す", () => {
    expect.hasAssertions();
    const decision = evaluateHookRequest({
      workingDirectory: repositoryRoot,
      role: "orchestrator",
      action: "FILE_MUTATION",
    });
    expect(decision).toStrictEqual({ decision: "allow" });
  });

  it("session.state が inactive の場合は全操作に対して allow を返す", () => {
    expect.hasAssertions();
    writeGraphFile(repositoryRoot, INACTIVE_GRAPH);
    const decision = evaluateHookRequest({
      workingDirectory: repositoryRoot,
      role: "planner",
      action: "FILE_MUTATION",
    });
    expect(decision).toStrictEqual({ decision: "allow" });
  });
});

describe("evaluateHookRequest: 稼働中セッションで許可されたアクション", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-engine-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repositoryRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("worker + FILE_MUTATION は allow を返す", () => {
    expect.hasAssertions();
    const decision = evaluateHookRequest({
      workingDirectory: repositoryRoot,
      role: "worker",
      action: "FILE_MUTATION",
    });
    expect(decision).toStrictEqual({ decision: "allow" });
  });

  it("planner + APPLY_OPS は allow を返す", () => {
    expect.hasAssertions();
    const decision = evaluateHookRequest({
      workingDirectory: repositoryRoot,
      role: "planner",
      action: "APPLY_OPS",
    });
    expect(decision).toStrictEqual({ decision: "allow" });
  });

  it("orchestrator + START_SESSION は allow を返す", () => {
    expect.hasAssertions();
    const decision = evaluateHookRequest({
      workingDirectory: repositoryRoot,
      role: "orchestrator",
      action: "START_SESSION",
    });
    expect(decision).toStrictEqual({ decision: "allow" });
  });
});

describe("evaluateHookRequest: 稼働中セッションで拒否されたアクション", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-engine-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repositoryRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("orchestrator + FILE_MUTATION は deny を返す", () => {
    expect.hasAssertions();
    const decision = evaluateHookRequest({
      workingDirectory: repositoryRoot,
      role: "orchestrator",
      action: "FILE_MUTATION",
    });
    if (decision.decision !== "deny") {
      throw new Error("Expected deny");
    }
    expect(decision.reason).toMatch(/worker/u);
  });

  it("planner + RECORD_RESULT は deny を返す", () => {
    expect.hasAssertions();
    const decision = evaluateHookRequest({
      workingDirectory: repositoryRoot,
      role: "planner",
      action: "RECORD_RESULT",
    });
    if (decision.decision !== "deny") {
      throw new Error("Expected deny");
    }
    expect(decision.reason).toMatch(/Worker/u);
  });
});

describe("evaluateHookRequest: linked worktree からの評価", () => {
  let parentDir: string;
  let repositoryRoot: string;
  let worktreeRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-engine-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
    worktreeRoot = createLinkedWorktree(repositoryRoot);
    writeGraphFile(repositoryRoot, ACTIVE_GRAPH);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("worktree で作業する Worker の FILE_MUTATION は許可される", () => {
    expect.hasAssertions();
    const decision = evaluateHookRequest({
      workingDirectory: worktreeRoot,
      role: "worker",
      action: "FILE_MUTATION",
    });
    expect(decision).toStrictEqual({ decision: "allow" });
  });

  it("worktree で作業する Integrator の ADVANCE_INTEGRATION は許可される", () => {
    expect.hasAssertions();
    const decision = evaluateHookRequest({
      workingDirectory: worktreeRoot,
      role: "integrator",
      action: "ADVANCE_INTEGRATION",
    });
    expect(decision).toStrictEqual({ decision: "allow" });
  });

  it("worktree からの Orchestrator の FILE_MUTATION は拒否される", () => {
    expect.hasAssertions();
    const decision = evaluateHookRequest({
      workingDirectory: worktreeRoot,
      role: "orchestrator",
      action: "FILE_MUTATION",
    });
    expect(decision.decision).toBe("deny");
  });
});

describe("evaluateHookRequest: リポジトリ外からの呼び出しは fail-closed で拒否する", () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-engine-test-"));
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("git リポジトリ外の作業ディレクトリは例外を投げず deny を返す", () => {
    expect.hasAssertions();
    const plainDir = path.join(parentDir, "plain");
    fs.mkdirSync(plainDir, { recursive: true });

    const decision = evaluateHookRequest({
      workingDirectory: plainDir,
      role: "worker",
      action: "READ_GRAPH",
    });
    if (decision.decision !== "deny") {
      throw new Error("Expected deny");
    }
    expect(decision.reason).toMatch(/ramune モードの稼働\/非稼働を判定できませんでした/u);
  });
});

describe("evaluateHookRequest: 不正な状態・入力は fail-closed で拒否する", () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-engine-test-"));
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("壊れたグラフファイルが存在する場合は例外を投げず deny を返す", () => {
    expect.hasAssertions();
    const repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, "{ corrupted json");

    const decision = evaluateHookRequest({
      workingDirectory: repoRoot,
      role: "worker",
      action: "READ_GRAPH",
    });
    if (decision.decision !== "deny") {
      throw new Error("Expected deny");
    }
    expect(decision.reason).toMatch(/ramune モードの稼働\/非稼働を判定できませんでした/u);
  });

  it("未知のアクションやロールが渡された場合は例外を投げず deny を返す", () => {
    expect.hasAssertions();
    const repoRoot = createCanonicalRepo(parentDir);
    writeGraphFile(repoRoot, ACTIVE_GRAPH);

    // SAFETY: テスト目的で無効なアクション型を渡し、エンジンが例外を捕獲して deny を返すことを検証する
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const invalidAction = "INVALID_ACTION" as ActionType;
    const decision = evaluateHookRequest({
      workingDirectory: repoRoot,
      role: "worker",
      action: invalidAction,
    });
    if (decision.decision !== "deny") {
      throw new Error("Expected deny");
    }
    expect(decision.reason).toMatch(/ramune hook \(policy\) の評価中にエラーが発生しました/u);
  });
});
