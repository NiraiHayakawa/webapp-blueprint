// GraphV2 の型と、初期グラフのコンストラクタ（設計正本 §2）。
//
// このファイルは .ramune/graph.json が表す DAG のデータ形だけを持つ。不変条件の検査は
// invariants.ts、差分操作は operations/ が担う（このファイルは検査・変更のロジックを持たない）。
import { z } from "zod";

import {
  allocationIdSchema,
  epochSchema,
  nonEmptyStringSchema,
  revisionSchema,
  runIdSchema,
  toNonEmptyString,
  type AllocationId,
  type Epoch,
  type NonEmptyString,
  type Revision,
  type RunId,
} from "./brand.ts";
import { START_NODE_ID, END_NODE_ID, graphNodeSchema, type GraphNode } from "./nodes.ts";

/**
 * ramune モード（Planner / Worker / Integrator の役割を hook が機械強制する状態）の
 * 稼働/非稼働を表す、グラフに外在化された明示的なフィールド。稼働中は run を識別する
 * runId と、resume ごとに +1 される epoch を持つ。
 */
export type GraphSession =
  | { readonly state: "inactive" }
  | { readonly state: "active"; readonly runId: RunId; readonly epoch: Epoch };

const graphSessionSchema = z.union([
  z.strictObject({ state: z.literal("inactive") }),
  z.strictObject({ state: z.literal("active"), runId: runIdSchema, epoch: epochSchema }),
]);

export interface GraphV2 {
  readonly version: 2;
  /** 成功した graph transaction ごとに +1。判断系ツールの OCC（§4）。 */
  readonly revision: Revision;
  /**
   * assignment / conflict / 機械生成ノードの ID を発番する永続 allocator。
   * 発番ごとに +1 し、再利用と wraparound を拒否する。
   */
  readonly nextAllocationId: AllocationId;
  readonly goal: NonEmptyString;
  readonly session: GraphSession;
  readonly nodes: readonly GraphNode[];
}

export const graphV2Schema = z.strictObject({
  version: z.literal(2),
  revision: revisionSchema,
  nextAllocationId: allocationIdSchema,
  goal: nonEmptyStringSchema,
  session: graphSessionSchema,
  nodes: z.array(graphNodeSchema),
});

/**
 * ゴールから、start と end の2ノードだけを持つ初期グラフを作る。
 * すべてのタスクノードはこの2ノードの間に insert_node で挿入される。
 *
 * boundary ノードは両方 pending から始まる。boundary を done に遷移させるのは
 * 機械操作だけである（Worker / Integrator は claim できない。§2.1）。
 * session は常に非稼働から始まり、稼働にするのは ramune_start MCP ツール
 * （start_session 差分操作）だけである。
 */
export function createGraph(goal: string): GraphV2 {
  return {
    version: 2,
    revision: revisionSchema.parse(0),
    nextAllocationId: allocationIdSchema.parse(1),
    goal: toNonEmptyString(goal),
    session: { state: "inactive" },
    nodes: [
      {
        kind: "boundary",
        boundary: "start",
        id: START_NODE_ID,
        title: toNonEmptyString("start"),
        deps: [],
        status: "pending",
      },
      {
        kind: "boundary",
        boundary: "end",
        id: END_NODE_ID,
        title: toNonEmptyString("end"),
        deps: [START_NODE_ID],
        status: "pending",
      },
    ],
  };
}

/** id に一致するノードを返す。無ければ undefined（呼び出し側が存在チェックを型で強制される）。 */
export function findNode(graph: GraphV2, id: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}
