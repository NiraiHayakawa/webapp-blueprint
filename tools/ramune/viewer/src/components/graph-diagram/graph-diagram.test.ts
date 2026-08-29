import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "@webapp-blueprint/ramune-graph";

// GraphV2 は branded type を全面採用しているため、生値は parseGraph を通して作る
// （取得口が本番で行う変換と同じ経路。features 側の test-support も同じ形）。
import { parseGraph } from "../../lib/graph-source/graph-source.ts";
import type { GraphV2 } from "../../lib/graph-source/graph-source.ts";
import { renderGraphDiagram } from "./graph-diagram.ts";

vi.setConfig({ testTimeout: 5000 });

function buildGraph(raw: JsonValue): GraphV2 {
  return parseGraph(JSON.stringify(raw));
}

function baseGraph(nodes: readonly JsonValue[]) {
  return {
    version: 2,
    revision: 0,
    nextAllocationId: 1,
    goal: "テストゴール",
    session: { state: "inactive" },
    nodes,
  };
}

const startPendingNode = {
  kind: "boundary",
  boundary: "start",
  id: "start",
  title: "start",
  deps: [],
  status: "pending",
};

const singleNodeGraph: GraphV2 = buildGraph(baseGraph([startPendingNode]));

// Planner が plan した read_only タスクノード。unit テストで必要なケースは少数のため
// 共通 helper を作らず、各グラフに完全な形で書く（features 側の test-support にある
// 同種の組み立て helper との重複検出を避ける意図もある）。
const abortedGraph: GraphV2 = buildGraph(
  baseGraph([
    startPendingNode,
    {
      kind: "task",
      id: "n1",
      title: "中止済みタスク",
      deps: ["start"],
      resolutions: [],
      purpose: "planned",
      effect: "read_only",
      status: "aborted",
    },
  ]),
);

const blockedGraph: GraphV2 = buildGraph(
  baseGraph([
    startPendingNode,
    {
      kind: "task",
      id: "n1",
      title: "詰まったタスク",
      deps: ["start"],
      resolutions: [],
      purpose: "planned",
      effect: "read_only",
      status: "blocked",
      phase: "execution",
      blockage: {
        id: 1,
        reason: "依存の見積もりが外れた",
        occurredAtRevision: 0,
        kind: "worker_request",
        assignment: { id: 1, nodeId: "n1", runId: "run-1", epoch: 0 },
      },
    },
  ]),
);

const nextNodeGraph: GraphV2 = buildGraph(
  baseGraph([
    {
      kind: "boundary",
      boundary: "start",
      id: "start",
      title: "start",
      deps: [],
      status: "done",
      result: { kind: "boundary", runId: "run-1", summary: "開始ノードを通過した" },
    },
    {
      kind: "task",
      id: "n1",
      title: "次のタスク",
      deps: ["start"],
      resolutions: [],
      purpose: "planned",
      effect: "read_only",
      status: "pending",
    },
  ]),
);

// Planner が実際に付けるタイトルは1文にわたる長文になる（タイトルが長文になるケースを許容するため）。
// 図のラベルに全文を描くと隣の列に重なって読めなくなるため、切り詰めを検証する。
const LONG_TITLE = "既存の最小縦切り scaffold を削除して後続タスクの下地にする";

const longTitleGraph: GraphV2 = buildGraph(
  baseGraph([
    {
      kind: "task",
      id: "n1",
      title: LONG_TITLE,
      deps: [],
      resolutions: [],
      purpose: "planned",
      effect: "read_only",
      status: "pending",
    },
  ]),
);

interface Case {
  readonly scenario: string;
  readonly graph: GraphV2;
  readonly nextNodeId: string | undefined;
  readonly expectedSubstring: string;
}

const cases: readonly Case[] = [
  {
    scenario: "ノードが1つも無い（空のグラフ）",
    graph: buildGraph(baseGraph([])),
    nextNodeId: undefined,
    expectedSubstring: "ノードがありません",
  },
  {
    scenario: "ノードが1つだけ",
    graph: singleNodeGraph,
    nextNodeId: undefined,
    expectedSubstring: 'data-node-id="start"',
  },
  {
    scenario: "aborted ノードを含む",
    graph: abortedGraph,
    nextNodeId: undefined,
    expectedSubstring: "node-aborted",
  },
  {
    scenario: "blocked ノードを含む",
    graph: blockedGraph,
    nextNodeId: undefined,
    expectedSubstring: "node-blocked",
  },
  {
    scenario: "次に選ばれるノードを強調する",
    graph: nextNodeGraph,
    nextNodeId: "n1",
    expectedSubstring: 'data-node-id="n1" data-next-node="true"',
  },
];

/**
 * Props-only な component のテスト（モック一切なし）。table-driven（object table +
 * `$field` 補間）。「グラフが空のとき・ノードが1つのとき・aborted を含むとき」を検証する。
 */
describe(renderGraphDiagram, () => {
  it.each(cases)(
    "$scenario のとき「$expectedSubstring」を含む",
    ({ graph, nextNodeId, expectedSubstring }) => {
      expect.hasAssertions();
      expect(renderGraphDiagram({ graph, nextNodeId })).toContain(expectedSubstring);
    },
  );

  it("aborted ノードが無い場合、ノードの class には node-aborted が付かない", () => {
    expect.hasAssertions();
    // 凡例は常に status ぶんの見本を表示するため "node-aborted" という文字列自体は
    // 出現し得る。ここではノード自身（<g class="node ...">）に絞って検証する。
    expect(renderGraphDiagram({ graph: singleNodeGraph, nextNodeId: undefined })).not.toContain(
      'class="node node-aborted"',
    );
  });

  it("長いタイトルは図のラベルでは切り詰められ、全文はツールチップに残る", () => {
    expect.hasAssertions();
    const svg = renderGraphDiagram({ graph: longTitleGraph, nextNodeId: undefined });
    // 切り詰めの上限（実装の定数）には依存させず、「省略記号で短くなっている」
    // ことと「全文が失われていない」ことだけを検証する。
    const label = /<text class="node-label"[^>]*>(?<label>[^<]*)<\/text>/u.exec(svg)?.groups?.[
      "label"
    ];
    expect(label).toMatch(/…$/u);
    expect(label?.length).toBeLessThan(LONG_TITLE.length);
    expect(svg).toContain(`<title>${LONG_TITLE}</title>`);
  });

  it("blocked ノードのツールチップには blockage の理由が含まれる", () => {
    expect.hasAssertions();
    expect(renderGraphDiagram({ graph: blockedGraph, nextNodeId: undefined })).toContain(
      "依存の見積もりが外れた",
    );
  });
});
