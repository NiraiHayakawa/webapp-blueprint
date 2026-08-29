import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphLocatorError } from "../src/locator.ts";
import { RamuneModeIndeterminateError, isRamuneModeActive } from "../src/mode.ts";
import { createCanonicalRepo, v2GraphJson, writeGraphFile } from "./support/fake-repo.ts";

// ramune モードの判定基準は canonical リポジトリの `.ramune/graph.json` の中身
// （v2 の `session.state`）であり、環境変数のような合成オブジェクトでは表現でき
// ない。各テストは実際の一時ディレクトリに git リポジトリの形を作り、その中に
// グラフファイルを置いて `isRamuneModeActive` にセッションの作業ディレクトリを渡す。

// eslint/max-lines-per-function は関数の物理的な行範囲（内側の describe/it の
// 行も含む）を見るため、1つの親 describe に子 describe をネストしても親自身の
// 行数は減らない。そのため各グループは兄弟のトップレベル describe に分け、
// 可変データはモジュールスコープの定数に置く。

const ACTIVE_GRAPH = v2GraphJson({ state: "active", runId: "run-1", epoch: 0 });
const INACTIVE_GRAPH = v2GraphJson({ state: "inactive" });

// 「ファイルはあるが session.state を読み取れない」ケース。v1 形（session.active）
// を含む — 旧フィールドの受理を残さないため判定不能＝拒否側になる（絶対規約3）。
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

describe(isRamuneModeActive, () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-mode-test-"));
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
});

describe("isRamuneModeActive: 判定不能(非稼働に丸めずエラーを投げる)", () => {
  let parentDir: string;
  let repositoryRoot: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-mode-test-"));
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

  it("エラーメッセージにファイルパスと対処方法を含める", () => {
    expect.hasAssertions();
    writeGraphFile(repositoryRoot, "{ not valid json");
    expect(() => isRamuneModeActive(repositoryRoot)).toThrow(/ramune_start/u);
  });
});

describe("isRamuneModeActive: canonical リポジトリを解決できない場合は fail-closed でエラーを投げる", () => {
  let plainDirectory: string;

  beforeEach(() => {
    // git リポジトリの形をしていない一時ディレクトリ。グラフの有無すら
    // 判定できないため、非稼働(false)に丸めず GraphLocatorError を投げる
    // （設計正本 §9「解決できなければ fail-closed で拒否」）。
    plainDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ramune-hooks-mode-test-plain-"));
  });

  afterEach(() => {
    fs.rmSync(plainDirectory, { recursive: true, force: true });
  });

  it("親方向に .git が存在しない作業ディレクトリは GraphLocatorError になる", () => {
    expect.hasAssertions();
    expect(() => isRamuneModeActive(plainDirectory)).toThrow(GraphLocatorError);
  });
});
