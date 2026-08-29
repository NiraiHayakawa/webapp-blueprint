// ramune_resume: サーバ / Orchestrator の死亡からのセッション再開（§7 / §8）。
// Orchestrator 専用。判断系ツールであるため expected_revision を要求する。
//
// integrating のノードが 1 件でも存在する場合は拒否される。統合中の Integrator の
// 死亡は、candidate と journal を保持したまま abandon_assignment の照合で状態を
// 確定させる手順があり、resume がそれを破壊する経路を機械で塞いでいる。
// ドメイン層（resumeSession）がこの前提条件を持ち、ツール層はそのエラーを
// 契約どおりの拒否として露出する。
//
// 設計正本 §8 の表にある引数は expected_revision のみである（reason は保存先の
// フィールドが存在しないため入力に含めない。含めると黙って捨てることになる）。
import type { GraphV2 } from "@webapp-blueprint/ramune-graph";
import { resumeSession, revisionSchema } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";

const inputSchema: InputSchema = {
  type: "object",
  properties: {
    expected_revision: { type: "integer", minimum: 0 },
  },
  required: ["expected_revision"],
  additionalProperties: false,
};

export interface ResumeInput {
  readonly expected_revision: number;
}

export const resumeTool: ToolDefinition<ResumeInput, GraphV2> = {
  name: "ramune_resume",
  description:
    "セッションを再開する。epoch を +1 し、旧 epoch の running assignment を" +
    "blocked(session_resumed) へ遷移させる。integrating ノードが存在する場合は" +
    "先に ramune_abandon_assignment の照合で確定させる必要があるため拒否される",
  inputSchema,
  handle: async (store, input) =>
    await store.transaction(
      { expectedRevision: revisionSchema.parse(input.expected_revision) },
      (graph) => resumeSession(graph, { type: "resume_session" }),
    ),
};
