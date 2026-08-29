// §2.8-1「数値は非負の safe integer」の検査。グラフに保存された値の形を検査する
// （加算時点の overflow 検査は transaction.ts）。
import type { GraphV2 } from "../graph.ts";
import type { GraphNode } from "../nodes.ts";
import type { InvariantViolation } from "../invariant-violation.ts";

type NumberCheck = readonly [field: string, value: number];

export function isNonNegativeSafeInt(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function violationFor(check: NumberCheck): InvariantViolation | undefined {
  if (isNonNegativeSafeInt(check[1])) {
    return undefined;
  }
  return {
    kind: "unsafe_number",
    field: check[0],
    value: check[1],
    detail: "非負の safe integer でなければならない",
  };
}

/** ノードに依存しない、グラフ本体の数値（revision / allocator / epoch）。 */
function graphLevelChecks(graph: GraphV2): readonly NumberCheck[] {
  const checks: NumberCheck[] = [
    ["revision", graph.revision],
    ["nextAllocationId", graph.nextAllocationId],
  ];
  if (graph.session.state === "active") {
    checks.push(["session.epoch", graph.session.epoch]);
  }
  return checks;
}

/** resolutions 履歴の revision（reopen ごとに記録される）。 */
function resolutionChecks(
  node: Extract<GraphNode, { readonly kind: "task" }>,
): readonly NumberCheck[] {
  return node.resolutions.map((record: { readonly reopenedAtRevision: number }): NumberCheck => [
    `resolutions.reopenedAtRevision(${node.id})`,
    record.reopenedAtRevision,
  ]);
}

/** live assignment の fence 数値（running のみ）。履歴の fence は検査しない。 */
function runningChecks(
  node: Extract<GraphNode, { readonly kind: "task" }>,
): readonly NumberCheck[] {
  if (node.status !== "running") {
    return [];
  }
  return [
    [`assignment.id(${node.id})`, node.assignment.id],
    [`assignment.epoch(${node.id})`, node.assignment.epoch],
  ];
}

/** candidate.source の数値（awaiting_integration / integrating）。 */
function candidateSourceChecks(
  node: Extract<GraphNode, { readonly kind: "task" }>,
): readonly NumberCheck[] {
  if (
    node.effect !== "repository_change" ||
    (node.status !== "awaiting_integration" && node.status !== "integrating")
  ) {
    return [];
  }
  return [
    [`candidate.source.id(${node.id})`, node.candidate.source.id],
    [`candidate.source.epoch(${node.id})`, node.candidate.source.epoch],
  ];
}

/** 統合 journal の assignment 数値（integrating のみ）。 */
function integrationJournalChecks(
  node: Extract<GraphNode, { readonly kind: "task" }>,
): readonly NumberCheck[] {
  if (node.effect !== "repository_change" || node.status !== "integrating") {
    return [];
  }
  return [
    [`integration.assignment.id(${node.id})`, node.integration.assignment.id],
    [`integration.assignment.epoch(${node.id})`, node.integration.assignment.epoch],
  ];
}

function taskNumberChecks(
  node: Extract<GraphNode, { readonly kind: "task" }>,
): readonly NumberCheck[] {
  return [
    ...resolutionChecks(node),
    ...runningChecks(node),
    ...candidateSourceChecks(node),
    ...integrationJournalChecks(node),
  ];
}

export function findUnsafeNumbers(graph: GraphV2): readonly InvariantViolation[] {
  const checks: NumberCheck[] = [...graphLevelChecks(graph)];
  for (const node of graph.nodes) {
    if (node.kind === "task") {
      checks.push(...taskNumberChecks(node));
    }
  }
  const violations: InvariantViolation[] = [];
  for (const check of checks) {
    const violation = violationFor(check);
    if (violation !== undefined) {
      violations.push(violation);
    }
  }
  return violations;
}
