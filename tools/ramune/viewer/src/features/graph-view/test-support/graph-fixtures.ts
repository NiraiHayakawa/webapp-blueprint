// .feature のシナリオが使うグラフのフィクスチャ。spec 本体から切り出しているのは
// 1ファイルの行数上限（max-lines 300。mise run check:complexity）に収めるためで、
// 「どんなグラフを与えるか」と「何を検証するか」は元々別の関心でもある。
//
// フィクスチャは生の JSON 値（JsonValue）を組み立てたうえで必ず `parseGraph` に
// 通す。本物の graphSource が返す値は常に parseGraph 済みであるため、フェイクも
// 同じ契約を満たすことをここで機械的に強制する（形が契約から外れたら ZodError
// として fail-fast する）。GraphV2 は branded type を全面採用しているため、生値の
// まま直書きした値は型として成立しない — parseGraph を通るのが唯一の作り方でもある。
import type { JsonValue } from "@webapp-blueprint/ramune-graph";

import { parseGraph } from "../../../lib/graph-source/graph-source.ts";
import type { GraphSource, GraphV2 } from "../../../lib/graph-source/graph-source.ts";

const RUN_ID = "run-1";
const ASSIGNMENT_ID = 1;
const BLOCKAGE_ID = 1;

/** 生の JSON 値を公開契約（parseGraph）に通して GraphV2 にする。 */
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

/** done になった start boundary。BoundaryResult を持つ。 */
function startDoneNode() {
  return {
    kind: "boundary",
    boundary: "start",
    id: "start",
    title: "start",
    deps: [],
    status: "done",
    result: { kind: "boundary", runId: RUN_ID, summary: "開始ノードを通過した" },
  };
}

/** Planner が plan した read_only タスクノードの共通部分。status 以降は呼び出し側が上書きする。 */
function taskNodeBase(node: {
  readonly id: string;
  readonly title: string;
  readonly deps: readonly string[];
}) {
  return {
    kind: "task",
    id: node.id,
    title: node.title,
    deps: node.deps,
    resolutions: [],
    purpose: "planned",
    effect: "read_only",
  };
}

export function createFakeGraphSource(graph: Readonly<GraphV2>): GraphSource {
  return { fetchGraph: async () => ({ found: true, graph }) };
}

export function createNotFoundGraphSource(): GraphSource {
  return { fetchGraph: async () => ({ found: false }) };
}

export function createGraphWithPendingNext(): GraphV2 {
  return buildGraph(
    baseGraph([
      startDoneNode(),
      { ...taskNodeBase({ id: "n1", title: "次のタスク", deps: ["start"] }), status: "pending" },
    ]),
  );
}

export function createGraphWithAbortedNode(): GraphV2 {
  return buildGraph(
    baseGraph([
      startDoneNode(),
      {
        ...taskNodeBase({ id: "n1", title: "中止済みタスク", deps: ["start"] }),
        status: "aborted",
      },
    ]),
  );
}

export function createGraphWithBlockedNode(): GraphV2 {
  return buildGraph(
    baseGraph([
      startDoneNode(),
      {
        ...taskNodeBase({ id: "n1", title: "詰まったタスク", deps: ["start"] }),
        status: "blocked",
        phase: "execution",
        blockage: {
          id: BLOCKAGE_ID,
          reason: "依存が複雑すぎた",
          occurredAtRevision: 0,
          kind: "worker_request",
          assignment: { id: ASSIGNMENT_ID, nodeId: "n1", runId: RUN_ID, epoch: 0 },
        },
      },
    ]),
  );
}

export function createGraphWithWaitingPendingNode(): GraphV2 {
  return buildGraph(
    baseGraph([
      startDoneNode(),
      {
        ...taskNodeBase({ id: "n1", title: "実行できるタスク", deps: ["start"] }),
        status: "pending",
      },
      { ...taskNodeBase({ id: "n2", title: "n1 を待つタスク", deps: ["n1"] }), status: "pending" },
    ]),
  );
}

export function createGraphWithResult(): GraphV2 {
  return buildGraph(
    baseGraph([
      {
        kind: "boundary",
        boundary: "start",
        id: "start",
        title: "start",
        deps: [],
        status: "pending",
      },
      {
        ...taskNodeBase({ id: "t1", title: "調査タスク", deps: ["start"] }),
        status: "done",
        result: {
          kind: "read_only",
          summary: "調査した結果",
          data: null,
          completedBy: { id: ASSIGNMENT_ID, nodeId: "t1", runId: RUN_ID, epoch: 0 },
        },
      },
    ]),
  );
}

export function createGraphWithActiveSession(): GraphV2 {
  const raw = baseGraph([startDoneNode()]);
  return buildGraph({
    ...raw,
    session: { state: "active", runId: RUN_ID, epoch: 0 },
  });
}

export function createGraphWithInactiveSession(): GraphV2 {
  return buildGraph(baseGraph([startDoneNode()]));
}
