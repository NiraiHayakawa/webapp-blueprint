import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphLocatorError } from "../../src/core/locator.ts";
import { RamuneModeIndeterminateError, isRamuneModeActive } from "../../src/core/mode.ts";
import {
  createCanonicalRepo,
  createLinkedWorktree,
  v2GraphJson,
  writeGraphFile,
} from "../support/fake-repo.ts";

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-1", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });

const INDETERMINATE_CASES = [
  {
    name: "グラフファイルが JSON として壊れている",
    content: "{ not valid json",
  },
  {
    name: "session フィールドが無い",
    content: JSON.stringify({ version: 2, goal: "g", nodes: [] }),
  },
  {
    name: "session.state フィールドが無い",
    content: JSON.stringify({
      version: 2,
      revision: 0,
      nextAllocationId: 1,
      goal: "g",
      session: { runId: "run-1", epoch: 0 },
      nodes: [],
    }),
  },
  {
    name: "session.state が文字列以外",
    content: JSON.stringify({
      version: 2,
      revision: 0,
      nextAllocationId: 1,
      goal: "g",
      session: { state: 1 },
      nodes: [],
    }),
  },
  {
    name: "session.state が未知の文字列",
    content: JSON.stringify({
      version: 2,
      revision: 0,
      nextAllocationId: 1,
      goal: "g",
      session: { state: "paused" },
      nodes: [],
    }),
  },
  {
    name: "v1 形の session.active しか無い",
    content: JSON.stringify({ version: 1, goal: "g", session: { active: true }, nodes: [] }),
  },
  { name: "トップレベルがオブジェクトではない", content: JSON.stringify([1, 2]) },
] as const;

describe("isRamuneModeActive: 正常系稼働・非稼働判定", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-mode-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it(".ramune/graph.json が無ければ非稼働(false)と判定する", () => {
    expect.hasAssertions();
    expect(isRamuneModeActive(repositoryRoot)).toBe(false);
  });

  it("session.state が active なら稼働中(true)と判定する", () => {
    expect.hasAssertions();
    writeGraphFile(repositoryRoot, ACTIVE_GRAPH);
    expect(isRamuneModeActive(repositoryRoot)).toBe(true);
  });

  it("session.state が inactive なら非稼働(false)と判定する", () => {
    expect.hasAssertions();
    writeGraphFile(repositoryRoot, INACTIVE_GRAPH);
    expect(isRamuneModeActive(repositoryRoot)).toBe(false);
  });

  it("linked worktree の作業ディレクトリから canonical の graph.json を正しく判定する", () => {
    expect.hasAssertions();
    const worktreeRoot = createLinkedWorktree(repositoryRoot);
    writeGraphFile(repositoryRoot, ACTIVE_GRAPH);
    expect(isRamuneModeActive(worktreeRoot)).toBe(true);
  });
});

describe("isRamuneModeActive: 判定不能（fail-closed でエラーを投げる）", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-mode-test-"));
    repositoryRoot = createCanonicalRepo(parentDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it.each(INDETERMINATE_CASES)(
    "$name ケースは RamuneModeIndeterminateError を投げる",
    ({ content }) => {
      expect.hasAssertions();
      writeGraphFile(repositoryRoot, content);
      expect(() => isRamuneModeActive(repositoryRoot)).toThrow(RamuneModeIndeterminateError);
    },
  );
});

describe("isRamuneModeActive: canonical リポジトリを解決できない場合は GraphLocatorError を投げる", () => {
  let plainDirectory: string;

  beforeEach(() => {
    plainDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-core-mode-test-plain-"));
  });

  afterEach(() => {
    fs.rmSync(plainDirectory, { recursive: true, force: true });
  });

  it("親方向に .git が存在しない作業ディレクトリは GraphLocatorError になる", () => {
    expect.hasAssertions();
    expect(() => isRamuneModeActive(plainDirectory)).toThrow(GraphLocatorError);
  });
});
