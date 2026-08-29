// ramune_apply_ops: 構造操作列（insert_node / insert_parallel_node / reopen / abort）を
// グラフに適用する。Planner 専用（権限の機械強制は @webapp-blueprint/ramune-hooks が
// 担う。このファイルはツールの入出力契約だけを持つ）。
//
// v2 での変更（§8）:
// - 操作列は insert_node / insert_parallel_node / reopen / abort のみ。set_result は
//   廃止され、Worker の完了は ramune_record_result が担う
// - insert_parallel_node は insert_node と異なり既存エッジの実在を前提条件にしない。
//   from に依存する newNode を新設し、to の deps へ newNode を追記するだけであり、
//   素の start -> end 骨格から独立な並列ノードを2本目以降作れる（insert_node は
//   from -> to のエッジを裂く splice 専用のため、1本目の挿入でエッジが消え2本目が
//   edge_not_found になる）
// - reopen には resolution が必須（ADR 0007）。verification_failed への reopen には
//   observed_git（canonical clean 観測）が必須
// - 実行中ノード（running / awaiting_integration / integrating）が 1 件でも
//   存在する場合は GraphHasActiveNodesError で拒否する
// - 判断系ツールであるため expected_revision を要求し、不一致は RevisionConflictError
//   として返す（自動リトライしない。§4）
//
// 入力 JSON Schema は graph パッケージの GraphOperation 判別共用体をフィールド単位で
// そのまま写す。各分岐を additionalProperties: false にした上で `type` の const で
// 判別する oneOf を使うため、未知の操作種別・必須フィールドの欠落・余分なフィールドは
// すべてデコード段階で拒否される。
import {
  applyOperations,
  plannedNodeIdSchema,
  revisionSchema,
  type GraphOperation,
  type GraphV2,
  type ReopenOperation,
} from "@webapp-blueprint/ramune-graph";
import { GraphHasActiveNodesError } from "../graph-has-active-nodes-error.ts";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";
import {
  type GitObservationInput,
  toDomainGitObservation,
  toDomainNonEmptyString,
} from "./wire.ts";

const newNodeInputSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    effect: { enum: ["read_only", "repository_change"] },
  },
  required: ["id", "title", "effect"],
  additionalProperties: false,
} as const;

const insertNodeOperationSchema = {
  type: "object",
  properties: {
    type: { const: "insert_node" },
    from: { type: "string", minLength: 1 },
    to: { type: "string", minLength: 1 },
    newNode: newNodeInputSchema,
  },
  required: ["type", "from", "to", "newNode"],
  additionalProperties: false,
} as const;

const insertParallelNodeOperationSchema = {
  type: "object",
  properties: {
    type: { const: "insert_parallel_node" },
    from: { type: "string", minLength: 1 },
    to: { type: "string", minLength: 1 },
    newNode: newNodeInputSchema,
  },
  required: ["type", "from", "to", "newNode"],
  additionalProperties: false,
} as const;

const gitObservationInputSchema = {
  type: "object",
  properties: {
    canonical_head: { type: "string", minLength: 1 },
    canonical_worktree: { enum: ["clean", "dirty", "merge_in_progress", "missing"] },
    integration_workspace: { enum: ["clean", "dirty", "merge_in_progress", "missing"] },
  },
  required: ["canonical_head", "canonical_worktree", "integration_workspace"],
  additionalProperties: false,
} as const;

const reopenOperationSchema = {
  type: "object",
  properties: {
    type: { const: "reopen" },
    nodeId: { type: "string", minLength: 1 },
    resolution: { type: "string", minLength: 1 },
    observed_git: gitObservationInputSchema,
  },
  required: ["type", "nodeId", "resolution"],
  additionalProperties: false,
} as const;

const abortOperationSchema = {
  type: "object",
  properties: {
    type: { const: "abort" },
    nodeId: { type: "string", minLength: 1 },
  },
  required: ["type", "nodeId"],
  additionalProperties: false,
} as const;

interface ReopenOperationInput {
  readonly type: "reopen";
  readonly nodeId: string;
  readonly resolution: string;
  readonly observed_git?: GitObservationInput;
}

type OperationInput =
  | Extract<GraphOperation, { type: "insert_node" }>
  | Extract<GraphOperation, { type: "insert_parallel_node" }>
  | ReopenOperationInput
  | Extract<GraphOperation, { type: "abort" }>;

const inputSchema: InputSchema = {
  type: "object",
  properties: {
    expected_revision: { type: "integer", minimum: 0 },
    operations: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          insertNodeOperationSchema,
          insertParallelNodeOperationSchema,
          reopenOperationSchema,
          abortOperationSchema,
        ],
      },
    },
  },
  required: ["expected_revision", "operations"],
  additionalProperties: false,
};

function toDomainOperation(op: OperationInput): GraphOperation {
  switch (op.type) {
    case "insert_node": {
      return {
        type: "insert_node",
        from: op.from,
        to: op.to,
        newNode: {
          // plannedNodeIdSchema が予約 ID（start / end）と機械生成名前空間を拒否する（§2.5）
          id: plannedNodeIdSchema.parse(op.newNode.id),
          title: toDomainNonEmptyString(op.newNode.title),
          effect: op.newNode.effect,
        },
      };
    }
    case "insert_parallel_node": {
      return {
        type: "insert_parallel_node",
        from: op.from,
        to: op.to,
        newNode: {
          // plannedNodeIdSchema が予約 ID（start / end）と機械生成名前空間を拒否する（§2.5）
          id: plannedNodeIdSchema.parse(op.newNode.id),
          title: toDomainNonEmptyString(op.newNode.title),
          effect: op.newNode.effect,
        },
      };
    }
    case "reopen": {
      const reopenOperation: ReopenOperation = {
        type: "reopen",
        nodeId: op.nodeId,
        resolution: toDomainNonEmptyString(op.resolution),
      };
      if (op.observed_git !== undefined) {
        return { ...reopenOperation, observedGit: toDomainGitObservation(op.observed_git) };
      }
      return reopenOperation;
    }
    case "abort": {
      return { type: "abort", nodeId: op.nodeId };
    }
    default: {
      // 網羅性チェック: 操作種別が増えたのにここが更新されていない場合、
      // ここで型検査が落ちる
      const exhaustive: never = op;
      throw new Error(`unknown operation type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** 実行中ノードの id 一覧（apply_ops の拒否条件。§8）。 */
function findActiveNodeIds(graph: GraphV2): readonly string[] {
  return graph.nodes
    .filter(
      (node) =>
        node.kind === "task" &&
        (node.status === "running" ||
          node.status === "awaiting_integration" ||
          node.status === "integrating"),
    )
    .map((node) => node.id);
}

export interface ApplyOpsInput {
  readonly expected_revision: number;
  readonly operations: readonly OperationInput[];
}

export const applyOpsTool: ToolDefinition<ApplyOpsInput, GraphV2> = {
  name: "ramune_apply_ops",
  description:
    "構造操作列（insert_node / insert_parallel_node / reopen / abort）をグラフに適用する。" +
    "insert_parallel_node は既存エッジの実在を前提条件にせず、from に依存する新規ノードを" +
    "作って to の deps へ追記する（並列ノードの fan-out 用）。" +
    "実行中ノード（running / awaiting_integration / integrating）が存在する場合、" +
    "適用後の状態が不変条件に違反する場合、個々の操作の前提条件を満たさない場合は拒否される。" +
    "reopen には resolution が必須",
  inputSchema,
  handle: async (store, input) =>
    await store.transaction(
      { expectedRevision: revisionSchema.parse(input.expected_revision) },
      (graph) => {
        const active = findActiveNodeIds(graph);
        if (active.length > 0) {
          throw new GraphHasActiveNodesError(active);
        }
        return applyOperations(graph, input.operations.map(toDomainOperation));
      },
    ),
};
