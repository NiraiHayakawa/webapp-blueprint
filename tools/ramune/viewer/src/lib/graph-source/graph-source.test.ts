import { afterEach, describe, expect, it, vi } from "vitest";

import type { GraphV2 } from "./graph-source.ts";
import { createGraphSource, parseGraph } from "./graph-source.ts";

// GraphV2 は branded type を全面採用しているため、生値は parseGraph を通して
// 作る（viewer が取得口で行う変換そのものを、テストの準備でも通る形にする）。
const validGraph: GraphV2 = parseGraph(
  JSON.stringify({
    version: 2,
    revision: 0,
    nextAllocationId: 1,
    goal: "テストゴール",
    session: { state: "inactive" },
    nodes: [
      {
        kind: "boundary",
        boundary: "start",
        id: "start",
        title: "start",
        deps: [],
        status: "pending",
      },
    ],
  }),
);

/**
 * fetch() は viewer から見て外部（tools/ramune/viewer/vite.config.ts のミドルウェア
 * 経由）との境界であり、これをスタブすることは実装詳細のモックではなく
 * 公開契約（createGraphSource().fetchGraph()）をこの境界越しに検証すること
 * にあたる（原則6「テスト対象は公開契約のみ」）。
 */
function stubFetchResponse(response: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
}

describe(createGraphSource, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("404（.ramune/graph.json がまだ存在しない）のとき found: false を返す", async () => {
    expect.hasAssertions();
    stubFetchResponse(new Response(null, { status: 404 }));

    const result = await createGraphSource().fetchGraph();

    expect(result).toStrictEqual({ found: false });
  });

  it("正常なグラフが返るとき found: true と graph を返す", async () => {
    expect.hasAssertions();
    stubFetchResponse(Response.json(validGraph));

    const result = await createGraphSource().fetchGraph();

    expect(result).toStrictEqual({ found: true, graph: validGraph });
  });

  it("404 でも 200 でもない失敗レスポンスは fail-fast で reject する", async () => {
    expect.hasAssertions();
    stubFetchResponse(new Response(null, { status: 500 }));

    await expect(createGraphSource().fetchGraph()).rejects.toThrow(/取得に失敗した/u);
  });

  // 拒否理由は「どのフィールドが契約から外れたか」を名指しすることまでが契約で
  // あり、文言そのものはスキーマ（@webapp-blueprint/ramune-graph の parseGraph）の
  // 実装詳細なので、フィールド名が現れることだけを見る。
  it("グラフの形が壊れている場合は隠蔽せず reject する（fail-fast）", async () => {
    expect.hasAssertions();
    stubFetchResponse(Response.json({ nonsense: true }));

    await expect(createGraphSource().fetchGraph()).rejects.toThrow(/version/u);
  });

  it("session フィールドが無い場合も、既定値で補わず reject する（fail-fast）", async () => {
    expect.hasAssertions();
    stubFetchResponse(Response.json({ version: 2, goal: "g", nodes: [] }));

    await expect(createGraphSource().fetchGraph()).rejects.toThrow(/session/u);
  });
});
