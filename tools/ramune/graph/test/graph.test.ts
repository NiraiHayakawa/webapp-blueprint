// createGraph の公開契約（§2）。
import { describe, expect, it } from "vitest";
import { createGraph, findNode } from "../src/index.ts";

describe(createGraph, () => {
  const graph = createGraph("在庫管理システムを作る");

  it("version は 2、revision は 0、nextAllocationId は 1 から始まる", () => {
    expect.hasAssertions();
    expect(graph.version).toBe(2);
    expect(graph.revision).toBe(0);
    expect(graph.nextAllocationId).toBe(1);
  });

  it("session は非稼働から始まる", () => {
    expect.hasAssertions();
    expect(graph.session).toStrictEqual({ state: "inactive" });
  });

  it("start / end の boundary ノードだけを持ち、end は start を依存する", () => {
    expect.hasAssertions();
    expect(graph.nodes.map((node) => node.id)).toStrictEqual(["start", "end"]);
    const start = findNode(graph, "start");
    expect(start).toMatchObject({
      kind: "boundary",
      boundary: "start",
      status: "pending",
      deps: [],
    });
    const end = findNode(graph, "end");
    expect(end).toMatchObject({
      kind: "boundary",
      boundary: "end",
      status: "pending",
      deps: ["start"],
    });
  });

  it("boundary ノードは assignment / candidate / resolutions を持たない（§2.1）", () => {
    expect.hasAssertions();
    for (const node of graph.nodes) {
      expect(node).not.toHaveProperty("assignment");
      expect(node).not.toHaveProperty("candidate");
      expect(node).not.toHaveProperty("resolutions");
      expect(node).not.toHaveProperty("effect");
    }
  });
});
