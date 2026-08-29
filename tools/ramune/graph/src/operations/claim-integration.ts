// claim_integration: 統合可能な candidate を1件 awaiting_integration → integrating に
// し、journal（claimed）を書く（ramune_claim_integration のグラフ層。§6.2）。
//
// 統合可能の条件は「awaiting_integration であり、deps がすべて done」。複数候補は
// 宣言順で tie-break し、最初の1件だけを統合する（graph 全体で integrating は高々
// 1 件という invariant の裏側）。canonicalHeadBefore は呼び出し側が観測した canonical
// HEAD であり、publish 時の expected HEAD 検査（§6.4）と crash 後の照合（§7）に使う。
import type { GraphV2 } from "../graph.ts";
import {
  assignmentIdSchema,
  type AllocationId,
  type CommitId,
  type IsoDateTime,
  type WorkspaceId,
} from "../brand.ts";
import { allocateId, finalizeTransaction } from "../transaction.ts";
import type { IntegrationJournal } from "../integration.ts";
import type { IntegratingNode } from "../narrowing.ts";
import type { GraphNode, RepositoryNode } from "../nodes.ts";

export interface ClaimIntegrationOperation {
  readonly type: "claim_integration";
  /** 統合用 worktree の識別子（canonical ではない。§2.2）。 */
  readonly workspaceId: WorkspaceId;
  readonly startedAt: IsoDateTime;
  /** claim 時点の canonical HEAD。publish CAS と照合の基準になる。 */
  readonly canonicalHeadBefore: CommitId;
}

export interface ClaimIntegrationResult {
  readonly graph: GraphV2;
  readonly journal: IntegrationJournal;
}

export type ClaimIntegrationPreconditionViolation =
  | { readonly reason: "session_not_active" }
  | { readonly reason: "no_integratable_candidate" };

export class ClaimIntegrationPreconditionError extends Error {
  readonly violation: ClaimIntegrationPreconditionViolation;

  constructor(violation: ClaimIntegrationPreconditionViolation) {
    super(`claim_integration の前提条件を満たさない: ${JSON.stringify(violation)}`);
    this.name = "ClaimIntegrationPreconditionError";
    this.violation = violation;
  }
}

type AwaitIntegratingCandidate = Extract<
  RepositoryNode,
  { readonly status: "awaiting_integration" }
>;

function isAwaiting(
  node: GraphNode,
): node is AwaitIntegratingCandidate & { readonly kind: "task" } {
  return (
    node.kind === "task" &&
    node.effect === "repository_change" &&
    node.status === "awaiting_integration"
  );
}

/** 統合可能ノード。awaiting_integration かつ全 deps done（§6.2）。 */
function firstIntegratable(graph: GraphV2): AwaitIntegratingCandidate | undefined {
  const doneIds = new Set<string>(
    graph.nodes.filter((node) => node.status === "done").map((node) => node.id),
  );
  for (const node of graph.nodes) {
    if (!isAwaiting(node)) {
      continue;
    }
    if (node.deps.every((depId) => doneIds.has(depId))) {
      return node;
    }
  }
  return undefined;
}

interface JournalInput {
  readonly session: Extract<GraphV2["session"], { readonly state: "active" }>;
  readonly target: AwaitIntegratingCandidate;
  readonly op: ClaimIntegrationOperation;
  readonly claimedId: AllocationId;
}

function buildIntegrationJournal(input: JournalInput): IntegrationJournal {
  const { session, target, op, claimedId } = input;
  return {
    assignment: {
      role: "integrator",
      id: assignmentIdSchema.parse(claimedId),
      nodeId: target.id,
      runId: session.runId,
      epoch: session.epoch,
      workspaceId: op.workspaceId,
      startedAt: op.startedAt,
    },
    candidateCommit: target.candidate.commit,
    canonicalHeadBefore: op.canonicalHeadBefore,
    progress: { stage: "claimed" },
  };
}

function toIntegratingNode(
  node: AwaitIntegratingCandidate & { readonly kind: "task" },
  journal: IntegrationJournal,
): IntegratingNode {
  const origin =
    node.purpose === "conflict_resolution"
      ? { purpose: node.purpose, resolves: node.resolves, conflict: node.conflict }
      : { purpose: node.purpose };
  return {
    kind: "task",
    id: node.id,
    title: node.title,
    deps: node.deps,
    resolutions: node.resolutions,
    ...origin,
    effect: "repository_change",
    status: "integrating",
    candidate: node.candidate,
    integration: journal,
  };
}

export function claimIntegration(
  graph: GraphV2,
  op: ClaimIntegrationOperation,
): ClaimIntegrationResult {
  if (graph.session.state !== "active") {
    throw new ClaimIntegrationPreconditionError({ reason: "session_not_active" });
  }
  const target = firstIntegratable(graph);
  if (!target) {
    throw new ClaimIntegrationPreconditionError({ reason: "no_integratable_candidate" });
  }

  const { session } = graph;
  const claimed = allocateId(graph);
  const journal = buildIntegrationJournal({ session, target, op, claimedId: claimed.id });

  const nodes = graph.nodes.map((node): GraphNode => {
    if (!isAwaiting(node) || node.id !== target.id) {
      return node;
    }
    return toIntegratingNode(node, journal);
  });

  return { graph: finalizeTransaction({ ...claimed.graph, nodes }), journal };
}
