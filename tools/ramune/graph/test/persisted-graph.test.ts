// parseGraph と readSessionActive の公開契約（object table + $field 補間の
// table-driven テスト。docs/principles/test-public-contract-only.md「仕様の言葉で
// 書けない場合」）。
import { describe, expect, it } from "vitest";
import {
  createGraph,
  GRAPH_FILE_RELATIVE_PATH,
  parseGraph,
  readSessionActive,
} from "../src/index.ts";
import { pendingReadOnly, pendingRepository, startedGraphWith } from "./test-support.ts";

const malformedGraphs: readonly { readonly name: string; readonly value: unknown }[] = [
  { name: "null", value: null },
  { name: "配列", value: [] },
  { name: "文字列", value: "not a graph" },
  {
    name: "version が欠落",
    value: {
      goal: "g",
      revision: 0,
      nextAllocationId: 1,
      session: { state: "inactive" },
      nodes: [],
    },
  },
  {
    name: "version が 1（v1 グラフは読まない）",
    value: { version: 1, goal: "g", session: { active: false }, nodes: [] },
  },
  {
    name: "version が 3",
    value: {
      version: 3,
      goal: "g",
      revision: 0,
      nextAllocationId: 1,
      session: { state: "inactive" },
      nodes: [],
    },
  },
  {
    name: "revision が欠落",
    value: {
      version: 2,
      goal: "g",
      nextAllocationId: 1,
      session: { state: "inactive" },
      nodes: [],
    },
  },
  {
    name: "nextAllocationId が欠落",
    value: { version: 2, goal: "g", revision: 0, session: { state: "inactive" }, nodes: [] },
  },
  {
    name: "session.state が未知の値",
    value: {
      version: 2,
      goal: "g",
      revision: 0,
      nextAllocationId: 1,
      session: { state: "paused" },
      nodes: [],
    },
  },
  {
    name: "v1 形の session.active を渡す",
    value: {
      version: 2,
      goal: "g",
      revision: 0,
      nextAllocationId: 1,
      session: { active: false },
      nodes: [],
    },
  },
];

describe("GRAPH_FILE_RELATIVE_PATH の値", () => {
  it(".ramune/graph.json という配置規約を持つ", () => {
    expect.hasAssertions();
    expect(GRAPH_FILE_RELATIVE_PATH).toBe(".ramune/graph.json");
  });
});

describe(parseGraph, () => {
  it("createGraph() が作る初期グラフを、そのままの値として読み戻せる", () => {
    expect.hasAssertions();
    const graph = createGraph("goal");
    expect(parseGraph(JSON.stringify(graph))).toStrictEqual(graph);
  });

  it('deps: ["start"] の task ノードを含む通常のグラフを、同値で読み戻せる（回帰: start 直下の task が保存後に拒否されていた）', () => {
    expect.hasAssertions();
    const graph = startedGraphWith([
      pendingReadOnly("ro1", ["start"]),
      pendingRepository("repo1", ["start"]),
    ]);
    const parsed = parseGraph(JSON.stringify(graph));
    expect(parsed).toStrictEqual(graph);
  });

  it("未知のフィールドは保持もせず拒否する（strict 契約。§2）", () => {
    expect.hasAssertions();
    const raw = {
      version: 2,
      goal: "g",
      revision: 0,
      nextAllocationId: 1,
      session: { state: "inactive" },
      nodes: [],
      future: "keep しない",
    };
    expect(() => parseGraph(JSON.stringify(raw))).toThrow(/future/u);
  });

  it.each(malformedGraphs)("$name の場合は投げる(silent に既定値で補わない)", ({ value }) => {
    expect.hasAssertions();
    expect(() => parseGraph(JSON.stringify(value))).toThrow(Error);
  });
});

describe(readSessionActive, () => {
  it.each([
    { name: "稼働中", session: { state: "active", runId: "r", epoch: 0 }, expected: true },
    { name: "非稼働", session: { state: "inactive" }, expected: false },
  ])("$name のグラフから state をそのまま読む", ({ session, expected }) => {
    expect.hasAssertions();
    const raw = { version: 2, goal: "g", revision: 0, nextAllocationId: 1, session, nodes: [] };
    expect(readSessionActive(JSON.stringify(raw))).toBe(expected);
  });

  it("session 以外が壊れていても読める（ADR 0005: hook は 1 ビットだけに依存する）", () => {
    expect.hasAssertions();
    const raw = {
      version: "壊れている",
      goal: 1,
      session: { state: "active", runId: "r", epoch: 0 },
      nodes: "配列ではない",
    };
    expect(readSessionActive(JSON.stringify(raw))).toBe(true);
  });

  it.each([
    { name: "null", value: null },
    { name: "文字列", value: "not a graph" },
    { name: "session が欠落", value: { version: 2, goal: "g" } },
    { name: "session が文字列", value: { session: "yes" } },
    { name: "session.state が欠落", value: { session: { runId: "r" } } },
    { name: "session.state が boolean（v1 形）", value: { session: { active: true } } },
  ])("$name の場合は undefined を返す(非稼働に丸めない)", ({ value }) => {
    expect.hasAssertions();
    expect(readSessionActive(JSON.stringify(value))).toBeUndefined();
  });
});
