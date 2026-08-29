// boundary ノード（start / end）の型と実行時契約（設計正本 §2.1）。
// nodes.ts（task ノード本体）から分離。機械操作だけが遷移させるノードであり、
// effect / assignment / candidate / resolutions を一切持たない。
import { z } from "zod";

import {
  nonEmptyStringSchema,
  runIdSchema,
  taskDepsSchema,
  type GeneratedNodeId,
  type NonEmptyString,
  type PlannedNodeId,
  type RunId,
} from "./brand.ts";

export const START_NODE_ID = "start";
export const END_NODE_ID = "end";

export interface BoundaryResult {
  readonly kind: "boundary";
  readonly runId: RunId;
  readonly summary: NonEmptyString;
}

const boundaryResultSchema = z.strictObject({
  kind: z.literal("boundary"),
  runId: runIdSchema,
  summary: nonEmptyStringSchema,
});

/** start / end の status。done になった boundary は run の証跡（BoundaryResult）を持つ。 */
type BoundaryStatus =
  | { readonly status: "pending" }
  | { readonly status: "done"; readonly result: BoundaryResult };

const pendingStatusPart = { status: z.literal("pending") } as const;
const doneBoundaryStatusPart = { status: z.literal("done"), result: boundaryResultSchema } as const;

export type StartBoundaryNode = BoundaryStatus & {
  readonly kind: "boundary";
  readonly boundary: "start";
  readonly id: typeof START_NODE_ID;
  readonly title: NonEmptyString;
  readonly deps: readonly [];
};

export type EndBoundaryNode = BoundaryStatus & {
  readonly kind: "boundary";
  readonly boundary: "end";
  readonly id: typeof END_NODE_ID;
  readonly title: NonEmptyString;
  /** end はシンクであり続ける。deps は task と start のみ。 */
  readonly deps: readonly (GeneratedNodeId | PlannedNodeId | typeof START_NODE_ID)[];
};

export type BoundaryNode = StartBoundaryNode | EndBoundaryNode;

export const startPendingNodeSchema = z.strictObject({
  kind: z.literal("boundary"),
  boundary: z.literal("start"),
  id: z.literal(START_NODE_ID),
  title: nonEmptyStringSchema,
  deps: z.tuple([]),
  ...pendingStatusPart,
});

export const startDoneNodeSchema = z.strictObject({
  kind: z.literal("boundary"),
  boundary: z.literal("start"),
  id: z.literal(START_NODE_ID),
  title: nonEmptyStringSchema,
  deps: z.tuple([]),
  ...doneBoundaryStatusPart,
});

export const endPendingNodeSchema = z.strictObject({
  kind: z.literal("boundary"),
  boundary: z.literal("end"),
  id: z.literal(END_NODE_ID),
  title: nonEmptyStringSchema,
  deps: taskDepsSchema,
  ...pendingStatusPart,
});

export const endDoneNodeSchema = z.strictObject({
  kind: z.literal("boundary"),
  boundary: z.literal("end"),
  id: z.literal(END_NODE_ID),
  title: nonEmptyStringSchema,
  deps: taskDepsSchema,
  ...doneBoundaryStatusPart,
});
