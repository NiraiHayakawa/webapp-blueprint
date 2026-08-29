import { describe, expect, it, vi } from "vitest";

import { extractMatrixTaskList } from "./github-actions-matrix.ts";

vi.setConfig({ testTimeout: 5000 });

describe(extractMatrixTaskList, () => {
  it("ブロックリストの matrix.task を読める", () => {
    expect.hasAssertions();
    const body = [
      "    strategy:",
      "      fail-fast: false",
      "      matrix:",
      "        task:",
      "          - lint",
      "          - fmt",
      "    steps:",
      "      - run: echo hi",
    ].join("\n");
    expect(extractMatrixTaskList(body)).toStrictEqual(["lint", "fmt"]);
  });

  it("インラインフローリストの matrix.task を読める", () => {
    expect.hasAssertions();
    const body = ["    strategy:", "      matrix:", "        task: [lint, fmt]"].join("\n");
    expect(extractMatrixTaskList(body)).toStrictEqual(["lint", "fmt"]);
  });

  it("matrix: が無ければ空配列を返す", () => {
    expect.hasAssertions();
    expect(extractMatrixTaskList("    steps:\n      - run: echo hi")).toStrictEqual([]);
  });

  it("matrix: 直下に task: が無ければ空配列を返す", () => {
    expect.hasAssertions();
    const body = [
      "    strategy:",
      "      matrix:",
      "        os:",
      "          - ubuntu-latest",
    ].join("\n");
    expect(extractMatrixTaskList(body)).toStrictEqual([]);
  });
});
