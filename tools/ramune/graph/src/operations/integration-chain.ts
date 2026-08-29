// 統合の解消 chain を同時に done にする共有ロジック（§6.3）。
//
// R の統合成功の transaction は、R と C（R 自身が再 conflict して R2 が生えていた
// 場合は、その解消 chain 全体）を同時に done にする。C / 中間 R の完了証跡は
// ConflictResolvedRepositoryResult であり、candidate は保持される。
// chain の途中で「resolves ↔ resolutionNodeId の相互参照が崩れている」「上流が
// integration_conflict blockage を持っていない」場合は undefined を返し、
// 呼び出し側が前提条件違反として扱う。
import type { GraphV2 } from "../graph.ts";
import { generatedNodeIdSchema } from "../brand.ts";
import type {
  ConflictResolvedRepositoryResult,
  IntegratedRepositoryResult,
  WorkReport,
} from "../work.ts";
import type { SuccessfulCheck } from "../integration.ts";
import type { AssignmentFence } from "../assignment.ts";
import type { GraphNode, RepositoryNode } from "../nodes.ts";

export interface ChainClosureInput {
  /** 統合が成功した terminal ノード（planned ノードまたは解消ノード）。 */
  readonly terminalId: string;
  readonly integratedCommit: CommitIdOfResult;
  readonly verification: SuccessfulCheck;
  readonly report: WorkReport;
  /** journal.assignment から取り出した Integrator の fence（完了証跡の integratedBy）。 */
  readonly integratedBy: AssignmentFence;
}

type CommitIdOfResult = IntegratedRepositoryResult["candidateCommit"];

type DoneRepositoryVariant = Extract<RepositoryNode, { readonly status: "done" }>;
type IntegratingTask = Extract<RepositoryNode, { readonly status: "integrating" }>;
type IntegrationBlockedTask = Extract<
  RepositoryNode,
  { readonly status: "blocked"; readonly phase: "integration" }
>;

/** chain のメンバー（統合中ノード、または candidate を保持したまま blocked になったノード）。 */
type ChainMember = IntegratingTask | IntegrationBlockedTask;

function isIntegrating(node: GraphNode | undefined): node is IntegratingTask {
  return (
    node !== undefined &&
    node.kind === "task" &&
    node.effect === "repository_change" &&
    node.status === "integrating"
  );
}

function isConflictBlocked(node: GraphNode | undefined): node is IntegrationBlockedTask {
  return (
    node !== undefined &&
    node.kind === "task" &&
    node.effect === "repository_change" &&
    node.status === "blocked" &&
    node.phase === "integration"
  );
}

function integratedResult(
  candidateCommit: CommitIdOfResult,
  input: ChainClosureInput,
): IntegratedRepositoryResult {
  return {
    kind: "integrated",
    summary: input.report.summary,
    data: input.report.data,
    candidateCommit,
    integratedCommit: input.integratedCommit,
    integratedBy: input.integratedBy,
    verification: input.verification,
  };
}

interface ResolvedResultInput {
  readonly conflictId: ConflictResolvedRepositoryResult["conflictId"];
  readonly resolutionNodeId: ConflictResolvedRepositoryResult["resolutionNodeId"];
  readonly originalCandidateCommit: CommitIdOfResult;
  readonly input: ChainClosureInput;
}

function resolvedResult(args: ResolvedResultInput): ConflictResolvedRepositoryResult {
  return {
    kind: "conflict_resolved",
    summary: args.input.report.summary,
    data: args.input.report.data,
    conflictId: args.conflictId,
    originalCandidateCommit: args.originalCandidateCommit,
    resolutionNodeId: args.resolutionNodeId,
    integratedCommit: args.input.integratedCommit,
    verification: args.input.verification,
  };
}

function markDone(
  updated: Map<string, DoneRepositoryVariant>,
  node: ChainMember,
  result: IntegratedRepositoryResult | ConflictResolvedRepositoryResult,
): void {
  const base = {
    kind: "task" as const,
    id: node.id,
    title: node.title,
    deps: node.deps,
    resolutions: node.resolutions,
    effect: "repository_change" as const,
  };
  const done: DoneRepositoryVariant =
    node.purpose === "conflict_resolution"
      ? {
          ...base,
          purpose: "conflict_resolution",
          resolves: node.resolves,
          conflict: node.conflict,
          status: "done",
          candidate: node.candidate,
          result,
        }
      : {
          ...base,
          purpose: "planned",
          status: "done",
          candidate: node.candidate,
          result,
        };
  updated.set(node.id, done);
}

/** cursor が期待する解消ノードを指す integration_conflict blockage を返す。不一致なら undefined。 */
function matchingConflictBlockage(
  upstream: IntegrationBlockedTask,
  expectedResolverId: string,
):
  | Extract<IntegrationBlockedTask["blockage"], { readonly kind: "integration_conflict" }>
  | undefined {
  const { blockage } = upstream;
  if (blockage.kind !== "integration_conflict") {
    return undefined;
  }
  if (blockage.resolutionNodeId !== expectedResolverId) {
    return undefined;
  }
  return blockage;
}

/** terminal ノードの完了証跡を組み立てる。解消ノードの ID が生成名前空間外なら undefined。 */
function terminalResult(
  terminal: IntegratingTask,
  input: ChainClosureInput,
): IntegratedRepositoryResult | ConflictResolvedRepositoryResult | undefined {
  if (terminal.purpose !== "conflict_resolution") {
    return integratedResult(terminal.candidate.commit, input);
  }
  // 解消ノードの ID は allocator 発番の GeneratedNodeId でなければならない（§2.5）
  const parsed = generatedNodeIdSchema.safeParse(terminal.id);
  if (!parsed.success) {
    return undefined;
  }
  return resolvedResult({
    conflictId: terminal.conflict.id,
    resolutionNodeId: parsed.data,
    originalCandidateCommit: terminal.candidate.commit,
    input,
  });
}

type UpstreamWalkStep =
  | { readonly outcome: "abort" }
  | { readonly outcome: "stop" }
  | {
      readonly outcome: "continue";
      readonly expectedResolverId: string;
      readonly upstreamId: string;
    };

/** 次に検証する上流 1 歩分の位置（自分を指す解消ノード ID と、その上流のノード ID）。 */
interface UpstreamCursor {
  readonly expectedResolverId: string;
  readonly upstreamId: string;
}

/** chain 全体を辿るあいだ不変な文脈（ノード索引・完了証跡の元・書き戻し先）。 */
interface WalkContext {
  readonly byId: ReadonlyMap<string, GraphNode>;
  readonly input: ChainClosureInput;
  readonly updated: Map<string, DoneRepositoryVariant>;
}

/** 上流の C を 1 歩 done に進める。前提違反は abort、planned の C で終端は stop。 */
function walkOneUpstream(ctx: WalkContext, cursor: UpstreamCursor): UpstreamWalkStep {
  const upstream = ctx.byId.get(cursor.upstreamId);
  if (!isConflictBlocked(upstream)) {
    return { outcome: "abort" };
  }
  const blockage = matchingConflictBlockage(upstream, cursor.expectedResolverId);
  if (blockage === undefined) {
    return { outcome: "abort" };
  }
  markDone(
    ctx.updated,
    upstream,
    resolvedResult({
      conflictId: blockage.conflict.id,
      resolutionNodeId: blockage.resolutionNodeId,
      originalCandidateCommit: upstream.candidate.commit,
      input: ctx.input,
    }),
  );
  if (upstream.purpose !== "conflict_resolution") {
    // planned の C で終端。上流は無い
    return { outcome: "stop" };
  }
  return {
    outcome: "continue",
    expectedResolverId: upstream.id,
    upstreamId: upstream.resolves,
  };
}

/**
 * 上流への歩行は「自分が解消ノードである」間だけ続く。planned の C が終端。
 * 前提違反（abort）が起きた場合は文字列を返す（呼び出し側が undefined へ変換）。
 */
function walkAllUpstream(ctx: WalkContext, terminal: IntegratingTask): string | undefined {
  let cursor: UpstreamCursor | undefined =
    terminal.purpose === "conflict_resolution"
      ? { expectedResolverId: terminal.id, upstreamId: terminal.resolves }
      : undefined;

  while (cursor !== undefined) {
    const step = walkOneUpstream(ctx, cursor);
    if (step.outcome === "abort") {
      return `upstream ${cursor.upstreamId} の blockage / 相互参照が崩れている`;
    }
    if (step.outcome === "stop") {
      break;
    }
    cursor = { expectedResolverId: step.expectedResolverId, upstreamId: step.upstreamId };
  }
  return undefined;
}

function applyChainClosure(
  graph: GraphV2,
  ctx: WalkContext,
  terminal: IntegratingTask,
): readonly GraphNode[] | undefined {
  const firstResult = terminalResult(terminal, ctx.input);
  if (firstResult === undefined) {
    return undefined;
  }
  markDone(ctx.updated, terminal, firstResult);
  const walkFailure = walkAllUpstream(ctx, terminal);
  if (walkFailure !== undefined) {
    return undefined;
  }
  return graph.nodes.map((node) => ctx.updated.get(node.id) ?? node);
}

/**
 * terminal ノードから解消 chain を上流へ辿り、chain 全体（terminal 含む）を done に
 * した次の nodes 配列を返す。
 *
 * - terminal が planned → IntegratedRepositoryResult を書いて終端（上流は無い）
 * - terminal が解消ノード → 自分は ConflictResolvedRepositoryResult。さらに resolves 先が
 *   「resolutionNodeId として自分を指す integration_conflict blockage を持つノード」
 *   である限り連鎖的に done。planned の C で終端になる
 */
export function closeResolutionChain(
  graph: GraphV2,
  input: ChainClosureInput,
): readonly GraphNode[] | undefined {
  const byId = new Map<string, GraphNode>(graph.nodes.map((node) => [node.id, node] as const));
  const terminal = byId.get(input.terminalId);
  if (!terminal || !isIntegrating(terminal)) {
    return undefined;
  }
  const ctx: WalkContext = { byId, input, updated: new Map() };
  return applyChainClosure(graph, ctx, terminal);
}
