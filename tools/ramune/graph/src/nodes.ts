// グラフノード（boundary / task）の型と実行時契約（設計正本 §2.1 / §2.7）。
//
// start / end は task ノードに偽装させず boundary という別 kind にする。effect /
// assignment / candidate / resolutions を一切持たず、機械操作だけが遷移させる
// （Worker / Integrator は claim できない）。task ノードは effect（read_only /
// repository_change）× status の discriminated union であり、status ごとの
// 必須 / 禁止フィールドが型で決まっている。
import { z } from "zod";

import {
  nonEmptyStringSchema,
  taskIdSchema,
  taskDepsSchema,
  type GeneratedNodeId,
  type NonEmptyString,
  type PlannedNodeId,
} from "./brand.ts";
import { readOnlyWorkerAssignmentSchema, repositoryWorkerAssignmentSchema } from "./assignment.ts";
import type { ReadOnlyWorkerAssignment, RepositoryWorkerAssignment } from "./assignment.ts";
import {
  conflictDescriptorSchema,
  executionBlockageSchema,
  integrationBlockageSchema,
  resolutionRecordSchema,
  type ExecutionBlockage,
  type IntegrationBlockage,
  type RepositoryOrigin,
  type ResolutionRecord,
} from "./blockage.ts";
import { candidateSchema, readOnlyResultSchema, repositoryResultSchema } from "./work.ts";
import type { Candidate, ReadOnlyResult, RepositoryResult } from "./work.ts";
import { integrationJournalSchema } from "./integration.ts";
import type { IntegrationJournal } from "./integration.ts";

// boundary ノードの型・スキーマ・定数は boundary-nodes.ts へ分離（下で再公開）。
import {
  type START_NODE_ID,
  type BoundaryNode,
  startPendingNodeSchema,
  startDoneNodeSchema,
  endPendingNodeSchema,
  endDoneNodeSchema,
} from "./boundary-nodes.ts";

export {
  START_NODE_ID,
  END_NODE_ID,
  type BoundaryResult,
  type StartBoundaryNode,
  type EndBoundaryNode,
  type BoundaryNode,
} from "./boundary-nodes.ts";

interface TaskNodeCommon {
  readonly kind: "task";
  readonly id: GeneratedNodeId | PlannedNodeId;
  readonly title: NonEmptyString;
  /** task は end に依存できない。 */
  readonly deps: readonly (GeneratedNodeId | PlannedNodeId | typeof START_NODE_ID)[];
  /** blocked → pending の reopen transaction だけが末尾へ追加できる（§2.6）。 */
  readonly resolutions: readonly ResolutionRecord[];
}

const taskCommon = {
  kind: z.literal("task"),
  id: taskIdSchema,
  title: nonEmptyStringSchema,
  deps: taskDepsSchema,
  resolutions: z.array(resolutionRecordSchema),
} as const;

/** repository_change ノードの由来。Planner が plan した形と、機械挿入された解消ノードの形。 */
const originVariants = [
  { purpose: z.literal("planned") },
  {
    purpose: z.literal("conflict_resolution"),
    resolves: taskIdSchema,
    conflict: conflictDescriptorSchema,
  },
] as const;

export type ReadOnlyNode = TaskNodeCommon & { readonly purpose: "planned" } & (
    | { readonly effect: "read_only"; readonly status: "pending" }
    | {
        readonly effect: "read_only";
        readonly status: "running";
        readonly assignment: ReadOnlyWorkerAssignment;
      }
    | {
        readonly effect: "read_only";
        readonly status: "blocked";
        readonly phase: "execution";
        readonly blockage: ExecutionBlockage;
      }
    | { readonly effect: "read_only"; readonly status: "aborted" }
    | { readonly effect: "read_only"; readonly status: "done"; readonly result: ReadOnlyResult }
  );

const readOnlyBase = {
  ...taskCommon,
  purpose: z.literal("planned"),
  effect: z.literal("read_only"),
} as const;

const readOnlyNodeSchema = z.union([
  z.strictObject({ ...readOnlyBase, status: z.literal("pending") }),
  z.strictObject({
    ...readOnlyBase,
    status: z.literal("running"),
    assignment: readOnlyWorkerAssignmentSchema,
  }),
  z.strictObject({
    ...readOnlyBase,
    status: z.literal("blocked"),
    phase: z.literal("execution"),
    blockage: executionBlockageSchema,
  }),
  z.strictObject({ ...readOnlyBase, status: z.literal("aborted") }),
  z.strictObject({
    ...readOnlyBase,
    status: z.literal("done"),
    result: readOnlyResultSchema,
  }),
]);

/**
 * repository_change ノード（設計正本 §2.7）。status ごとの必須 / 禁止フィールド:
 * pending は何も持たず、running は assignment、awaiting_integration は candidate、
 * integrating は candidate + integration journal、blocked は phase に応じた
 * blockage（統合段階では candidate も保持）、aborted は何も持たない、
 * done は candidate + result。
 */
export type RepositoryNode = TaskNodeCommon &
  RepositoryOrigin &
  (
    | { readonly effect: "repository_change"; readonly status: "pending" }
    | {
        readonly effect: "repository_change";
        readonly status: "running";
        readonly assignment: RepositoryWorkerAssignment;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "awaiting_integration";
        readonly candidate: Candidate;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "integrating";
        readonly candidate: Candidate;
        readonly integration: IntegrationJournal;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "blocked";
        readonly phase: "execution";
        readonly blockage: ExecutionBlockage;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "blocked";
        readonly phase: "integration";
        readonly candidate: Candidate;
        readonly blockage: IntegrationBlockage;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "aborted";
      }
    | {
        readonly effect: "repository_change";
        readonly status: "done";
        readonly candidate: Candidate;
        readonly result: RepositoryResult;
      }
  );

const repositoryEffectPart = { effect: z.literal("repository_change") } as const;

function repositoryStatusVariants(
  statusPart:
    | { status: z.ZodLiteral<"pending"> }
    | {
        status: z.ZodLiteral<"running">;
        assignment: typeof repositoryWorkerAssignmentSchema;
      }
    | { status: z.ZodLiteral<"awaiting_integration">; candidate: typeof candidateSchema }
    | {
        status: z.ZodLiteral<"integrating">;
        candidate: typeof candidateSchema;
        integration: typeof integrationJournalSchema;
      }
    | {
        status: z.ZodLiteral<"blocked">;
        phase: z.ZodLiteral<"execution">;
        blockage: typeof executionBlockageSchema;
      }
    | {
        status: z.ZodLiteral<"blocked">;
        phase: z.ZodLiteral<"integration">;
        candidate: typeof candidateSchema;
        blockage: typeof integrationBlockageSchema;
      }
    | { status: z.ZodLiteral<"aborted"> }
    | {
        status: z.ZodLiteral<"done">;
        candidate: typeof candidateSchema;
        result: typeof repositoryResultSchema;
      },
) {
  const planned = z.strictObject({
    ...taskCommon,
    ...originVariants[0],
    ...repositoryEffectPart,
    ...statusPart,
  });
  const resolved = z.strictObject({
    ...taskCommon,
    ...originVariants[1],
    ...repositoryEffectPart,
    ...statusPart,
  });
  return [planned, resolved];
}

const repositoryNodeSchema = z.union([
  ...repositoryStatusVariants({ status: z.literal("pending") }),
  ...repositoryStatusVariants({
    status: z.literal("running"),
    assignment: repositoryWorkerAssignmentSchema,
  }),
  ...repositoryStatusVariants({
    status: z.literal("awaiting_integration"),
    candidate: candidateSchema,
  }),
  ...repositoryStatusVariants({
    status: z.literal("integrating"),
    candidate: candidateSchema,
    integration: integrationJournalSchema,
  }),
  ...repositoryStatusVariants({
    status: z.literal("blocked"),
    phase: z.literal("execution"),
    blockage: executionBlockageSchema,
  }),
  ...repositoryStatusVariants({
    status: z.literal("blocked"),
    phase: z.literal("integration"),
    candidate: candidateSchema,
    blockage: integrationBlockageSchema,
  }),
  ...repositoryStatusVariants({ status: z.literal("aborted") }),
  ...repositoryStatusVariants({
    status: z.literal("done"),
    candidate: candidateSchema,
    result: repositoryResultSchema,
  }),
]);

/** グラフに置けるノード全体の union。 */
export type GraphNode = BoundaryNode | ReadOnlyNode | RepositoryNode;

export const graphNodeSchema = z.union([
  startPendingNodeSchema,
  startDoneNodeSchema,
  endPendingNodeSchema,
  endDoneNodeSchema,
  readOnlyNodeSchema,
  repositoryNodeSchema,
]);
