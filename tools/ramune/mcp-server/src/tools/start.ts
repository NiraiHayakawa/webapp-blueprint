// ramune_start: グラフが無ければ goal で作成し、ramune モードを稼働状態にする。
// Orchestrator 専用（権限の機械強制は @webapp-blueprint/ramune-hooks が担う。ADR 0003）。
//
// runId はサーバー（このツール）が crypto.randomUUID() で発番する（§8）。
// start boundary の完了証跡にこの runId が刻まれるため、run の同一性は
// グラフそのものが保持する。
//
// .ramune/graph.json が version 2 以外（v1 ファイル等）の場合、store が
// UnsupportedGraphVersionError を投げる。自動 archive はしない（§4 の明示操作）。
// エラーメッセージが archiveUnsupportedVersion() による退避手順を案内する。
// oxlint-disable-next-line import/no-nodejs-modules -- main.ts のコメント参照。
import { randomUUID } from "node:crypto";
import { runIdSchema, startSession, type GraphV2 } from "@webapp-blueprint/ramune-graph";
import type { InputSchema, ToolDefinition } from "../tool-definition.ts";

const inputSchema: InputSchema = {
  type: "object",
  properties: {
    goal: { type: "string", minLength: 1 },
  },
  required: ["goal"],
  additionalProperties: false,
};

export interface StartInput {
  readonly goal: string;
}

export const startTool: ToolDefinition<StartInput, GraphV2> = {
  name: "ramune_start",
  description:
    ".ramune/graph.json が無ければ goal で作成し、ramune モードを稼働状態にする。" +
    "既に稼働中の場合は拒否する(黙って上書きしない)",
  inputSchema,
  handle: async (store, input) => {
    // ファイルが無ければここで作られる（作成経路は store へ集約。§4）
    await store.initialize(input.goal);
    return await store.transaction({}, (graph) =>
      startSession(graph, {
        type: "start_session",
        runId: runIdSchema.parse(randomUUID()),
      }),
    );
  },
};
