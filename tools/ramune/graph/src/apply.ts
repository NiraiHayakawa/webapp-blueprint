// 構造操作列（ramune_apply_ops のグラフ層）の適用。適用後の状態に対して不変条件を
// 検査し、違反があれば適用そのものを拒否する（部分適用を残さない。
// docs/principles/fail-fast.md）。
//
// v2 での変更（§8）:
// - 操作列は Planner の構造操作（insert_node / reopen / abort）だけである。
//   set_result は廃止され、Worker の完了は record_result / submit_candidate /
//   統合系の各操作が担う
// - 1 回の適用 = 1 transaction であり、revision は列の最後で +1 される
//   （個々の操作は遷移だけを行い finalizeTransaction を呼ばない）
//
// Graph はすべて readonly なイミュータブルな値なので、各操作は「新しい Graph を返す」
// だけで元の Graph を書き換えない。実行中ノード（running / awaiting_integration /
// integrating）が存在する場合の適用拒否は、このツールの入口で行う契約であり
// （§8）、ここでは操作ごとの前提条件と不変条件を検査する。
import type { GraphV2 } from "./graph.ts";
import { finalizeTransaction } from "./transaction.ts";
import { abort, type AbortOperation } from "./operations/abort.ts";
import { insertNode, type InsertNodeOperation } from "./operations/insert-node.ts";
import {
  insertParallelNode,
  type InsertParallelNodeOperation,
} from "./operations/insert-parallel-node.ts";
import { reopen, type ReopenOperation } from "./operations/reopen.ts";

export type GraphOperation =
  | InsertNodeOperation
  | InsertParallelNodeOperation
  | ReopenOperation
  | AbortOperation;

/**
 * 単発の公開操作は「1 操作 = 1 transaction」として revision を +1 する。列の適用では
 * 最後にまとめて +1 するため、各ステップの結果から加算を差し引く。不変条件検査と
 * 前提条件検査はステップごとに走る（早期に fail する方が違反の原因を絞り込める）。
 */
function stripRevisionBump<T extends GraphOperation>(
  single: (graph: GraphV2, op: T) => GraphV2,
  graph: GraphV2,
  op: T,
): GraphV2 {
  const applied = single(graph, op);
  return { ...applied, revision: graph.revision };
}

// 列の途中では revision を加算しないため、各操作を「raw モード」で呼ぶ:
// 単発の公開関数（insertNode / reopen / abort）は 1 操作 = 1 transaction として
// 振る舞うため、その結果から transaction 分の加算を差し引いて列を組む。

function insertNodeRaw(graph: GraphV2, op: InsertNodeOperation): GraphV2 {
  return stripRevisionBump(insertNode, graph, op);
}

function insertParallelNodeRaw(graph: GraphV2, op: InsertParallelNodeOperation): GraphV2 {
  return stripRevisionBump(insertParallelNode, graph, op);
}

function reopenRaw(graph: GraphV2, op: ReopenOperation): GraphV2 {
  return stripRevisionBump(reopen, graph, op);
}

function abortRaw(graph: GraphV2, op: AbortOperation): GraphV2 {
  return stripRevisionBump(abort, graph, op);
}

function applyOne(graph: GraphV2, op: GraphOperation): GraphV2 {
  switch (op.type) {
    case "insert_node": {
      return insertNodeRaw(graph, op);
    }
    case "insert_parallel_node": {
      return insertParallelNodeRaw(graph, op);
    }
    case "reopen": {
      return reopenRaw(graph, op);
    }
    case "abort": {
      return abortRaw(graph, op);
    }
    default: {
      // 網羅性チェック: GraphOperation に新しい種類が増えたのにここが更新されていない場合、
      // ここで型検査が落ちる
      const exhaustive: never = op;
      throw new Error(`unknown operation type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * 操作列を順番に適用し、最終状態に対してグラフ不変条件を検査する。
 * 不変条件に違反したら GraphInvariantViolationError を投げ、graph 引数はそのまま
 * 呼び出し側に残る。各操作自身の前提条件違反（存在しないノードを指す等）は
 * 各操作が個別の型付きエラーを投げる。成功した場合は revision がちょうど 1 加算
 * された新しい Graph を返す。
 */
export function applyOperations(graph: GraphV2, operations: readonly GraphOperation[]): GraphV2 {
  let result = graph;
  for (const op of operations) {
    result = applyOne(result, op);
  }
  return finalizeTransaction(result);
}
