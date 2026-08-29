// テスト共通のフィクスチャビルダー。
//
// できる限り公開操作（createGraph / startSession / claimReady / ...）を連鎖させて
// 状態を作る。実行中系・blocked などの中間状態を直接組み立てる必要がある場合だけ、
// このファイルのビルダーを使う（brand の mint もここに集約し、テスト本体には
// キャストを出さない）。
import {
  advanceIntegration,
  claimIntegration,
  claimReady,
  assignmentIdSchema,
  commitIdSchema,
  createGraph,
  digestSchema,
  fenceOf,
  taskIdSchema,
  epochSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  plannedNodeIdSchema,
  revisionSchema,
  runIdSchema,
  startSession,
  submitCandidate,
  workspaceIdSchema,
  type AssignmentFence,
  type GraphV2,
  type ReadOnlyNode,
  type ReadOnlyWorkerAssignment,
  type RepositoryNode,
} from "../src/index.ts";

export const RUN_ID = runIdSchema.parse("run-1");
const EPOCH_0 = epochSchema.parse(0);
export const T0 = isoDateTimeSchema.parse("2026-08-24T00:00:00Z");
export const T1 = isoDateTimeSchema.parse("2026-08-24T01:00:00Z");
export const COMMIT_A = commitIdSchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
export const COMMIT_B = commitIdSchema.parse("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
export const CHECKED = commitIdSchema.parse("cccccccccccccccccccccccccccccccccccccccc");
const DIGEST = digestSchema.parse("digest");
export const WORKSPACE_1 = workspaceIdSchema.parse("ws-1");
export const WORKSPACE_INTEGRATION = workspaceIdSchema.parse("ws-integration");

/** フィクスチャが返す「状態を進めたグラフと、次の操作に提示する fence」のペア。 */
export interface GraphWithFence {
  readonly graph: GraphV2;
  readonly fence: AssignmentFence;
}

export function titleOf(title: string): ReturnType<typeof nonEmptyStringSchema.parse> {
  return nonEmptyStringSchema.parse(title);
}

export function plannedId(id: string): ReturnType<typeof plannedNodeIdSchema.parse> {
  return plannedNodeIdSchema.parse(id);
}

export function rev(n: number): ReturnType<typeof revisionSchema.parse> {
  return revisionSchema.parse(n);
}

function baseGraph(): GraphV2 {
  return createGraph("テスト用のゴール");
}

/** start_session を適用した稼働グラフ。 */
function startedGraph(): GraphV2 {
  return startSession(baseGraph(), { type: "start_session", runId: RUN_ID });
}

export function startedGraphWith(nodes: readonly GraphV2["nodes"][number][]): GraphV2 {
  const graph = startedGraph();
  return { ...graph, nodes: [...graph.nodes, ...nodes] };
}

function taskIdOf(id: string): ReturnType<typeof plannedNodeIdSchema.parse> {
  return plannedNodeIdSchema.parse(id);
}

export function pendingReadOnly(id: string, deps: readonly string[] = []): ReadOnlyNode {
  return {
    kind: "task",
    id: plannedId(id),
    title: titleOf(id),
    deps: deps.map((dep) => (dep === "start" ? "start" : taskIdOf(dep))),
    resolutions: [],
    purpose: "planned",
    effect: "read_only",
    status: "pending",
  };
}

export function pendingRepository(id: string, deps: readonly string[] = []): RepositoryNode {
  return {
    kind: "task",
    id: plannedId(id),
    title: titleOf(id),
    deps: deps.map((dep) => (dep === "start" ? "start" : taskIdOf(dep))),
    resolutions: [],
    purpose: "planned",
    effect: "repository_change",
    status: "pending",
  };
}

/** repository_change ノード 1 件を candidate 提出まで進めたグラフ（統合系テストの入口）。 */
export function awaitingGraph(): GraphV2 {
  const claimed = claimReady(startedGraphWith([pendingRepository("r1", ["start"])]), {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
    workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
  });
  const [assignment] = claimed.assignments;
  if (!assignment) {
    throw new Error("claim に失敗したフィクスチャ");
  }
  return submitCandidate(claimed.graph, {
    type: "submit_candidate",
    nodeId: "r1",
    fence: assignment,
    commit: COMMIT_A,
    report: { summary: nonEmptyStringSchema.parse("統合した"), data: null },
    submittedAt: T0,
  });
}

export function assignmentIdOf(n: number): ReturnType<typeof assignmentIdSchema.parse> {
  return assignmentIdSchema.parse(n);
}

/** fence をテストから提示するときのリテラル。nodeId は task ID 契約を通す。 */
export function fenceOfIds(id: number, nodeId: string): AssignmentFence {
  return {
    id: assignmentIdOf(id),
    nodeId: taskIdSchema.parse(nodeId),
    runId: RUN_ID,
    epoch: EPOCH_0,
  };
}

export function epochZero(): ReturnType<typeof epochSchema.parse> {
  return epochSchema.parse(0);
}

/** fn を実行し、投げられた Error を返す（投げなければ undefined）。catch 節の中で expect しないための橋渡し。 */
export function thrownBy(fn: () => void): Error | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return error;
  }
}

/** running 状態の read_only 割当を組み立てる（実行中系ノードの固定を要するテスト専用）。 */
export function readOnlyAssignmentOf(nodeId: string): ReadOnlyWorkerAssignment {
  return {
    role: "worker",
    effect: "read_only",
    id: assignmentIdOf(1),
    nodeId: plannedNodeIdSchema.parse(nodeId),
    runId: RUN_ID,
    epoch: epochZero(),
    startedAt: T0,
  };
}

/** start に依存する n1 と、n1 に依存する n2 を持つ pending グラフ（挿入操作系テストの共通フィクスチャ）。 */
export function graphWithTask(): GraphV2 {
  const graph = createGraph("goal");
  return {
    ...graph,
    nodes: [...graph.nodes, pendingReadOnly("n1", ["start"]), pendingReadOnly("n2", ["n1"])],
  };
}

/** start_session を適用した後、read_only（ro1）と repository_change（repo1）のタスクを挿入済みの稼働グラフ。 */
export function startedWithTasks(): GraphV2 {
  const base = createGraph("goal");
  return startSession(
    {
      ...base,
      nodes: [
        ...base.nodes,
        pendingReadOnly("ro1", ["start"]),
        pendingRepository("repo1", ["start"]),
      ],
    },
    { type: "start_session", runId: RUN_ID },
  );
}

/** startedWithTasks の ro1 を Worker が claim した状態。 */
export function claimedReadOnly(): GraphWithFence {
  const claimed = claimReady(startedWithTasks(), {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
  });
  const [fence] = claimed.assignments;
  if (!fence) {
    throw new Error("フィクスチャ構築に失敗");
  }
  return { graph: claimed.graph, fence };
}

/** repo1 を candidate 提出まで進め、Integrator が claim_integration した状態。 */
export function integratingRepo(): GraphWithFence {
  const base = createGraph("goal");
  const started = startSession(
    { ...base, nodes: [...base.nodes, pendingRepository("repo1", ["start"])] },
    { type: "start_session", runId: RUN_ID },
  );
  const workerClaim = claimReady(started, {
    type: "claim_ready",
    limit: 1,
    startedAt: T0,
    workspaces: [{ workspaceId: WORKSPACE_1, baseCommit: COMMIT_A }],
  });
  const [workerFence] = workerClaim.assignments;
  if (!workerFence) {
    throw new Error("フィクスチャ構築に失敗");
  }
  const awaiting = submitCandidate(workerClaim.graph, {
    type: "submit_candidate",
    nodeId: "repo1",
    fence: workerFence,
    commit: COMMIT_A,
    report: { summary: nonEmptyStringSchema.parse("報告"), data: null },
    submittedAt: T0,
  });
  const integration = claimIntegration(awaiting, {
    type: "claim_integration",
    workspaceId: WORKSPACE_INTEGRATION,
    startedAt: T0,
    canonicalHeadBefore: COMMIT_B,
  });
  return { graph: integration.graph, fence: fenceOf(integration.journal.assignment) };
}

/** integratingRepo を merge_prepared -> publish_prepared（check 成功）まで進めた状態。 */
export function publishPreparedRepo(): GraphWithFence {
  const setup = integratingRepo();
  const merged = advanceIntegration(setup.graph, {
    type: "advance_integration",
    fence: setup.fence,
    progress: { stage: "merge_prepared", integratedCommit: CHECKED },
  });
  const prepared = advanceIntegration(merged, {
    type: "advance_integration",
    fence: setup.fence,
    progress: {
      stage: "publish_prepared",
      integratedCommit: CHECKED,
      verification: { checkedCommit: CHECKED, outputDigest: DIGEST, finishedAt: T1 },
    },
  });
  return { graph: prepared, fence: setup.fence };
}
