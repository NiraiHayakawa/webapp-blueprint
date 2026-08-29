import { describe, expect, it, vi } from "vitest";

import { buildNodeFragment, parseSelectedNodeId } from "./selected-node.ts";

vi.setConfig({ testTimeout: 5000 });

describe(parseSelectedNodeId, () => {
  it("ノードを指すフラグメントから id を取り出す", () => {
    expect.hasAssertions();
    expect(parseSelectedNodeId("#node-contract-layer")).toBe("contract-layer");
  });

  it("percent encoding された id を復元する", () => {
    expect.hasAssertions();
    expect(parseSelectedNodeId(buildNodeFragment("契約層 の 配線"))).toBe("契約層 の 配線");
  });

  it("ノードを指していないフラグメントは undefined を返す", () => {
    expect.hasAssertions();
    expect(parseSelectedNodeId("")).toBeUndefined();
    expect(parseSelectedNodeId("#other")).toBeUndefined();
    expect(parseSelectedNodeId("#node-")).toBeUndefined();
  });
});
