import { describe, expect, it, vi } from "vitest";

import {
  extractEnvEntries,
  extractImageRefs,
  extractJobBody,
  extractJobs,
} from "./github-actions-workflow.ts";

vi.setConfig({ testTimeout: 5000 });

const NEEDS_LESS_JOB_YAML = [
  "jobs:",
  "  build:",
  '    runs-on: "ubuntu-latest"',
  "    steps:",
  "      - run: echo hi",
].join("\n");

const INLINE_SCALAR_NEEDS_YAML = [
  "jobs:",
  "  build:",
  "    steps: []",
  "  gate:",
  "    needs: build",
  "    steps: []",
].join("\n");

const INLINE_FLOW_LIST_NEEDS_YAML = [
  "jobs:",
  "  lint:",
  "    steps: []",
  "  test:",
  "    steps: []",
  "  gate:",
  "    needs: [lint, test]",
  "    steps: []",
].join("\n");

const BLOCK_LIST_NEEDS_YAML = [
  "jobs:",
  "  lint:",
  "    steps: []",
  "  test:",
  "    steps: []",
  "  gate:",
  "    needs:",
  "      - lint",
  "      - test",
  "    steps: []",
].join("\n");

describe(extractJobs, () => {
  it("needs が無いジョブは空配列を返す", () => {
    expect.hasAssertions();
    const jobs = extractJobs(NEEDS_LESS_JOB_YAML);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toStrictEqual({ id: "build", needs: [] });
  });

  it("インラインスカラーの needs を読める", () => {
    expect.hasAssertions();
    const jobs = extractJobs(INLINE_SCALAR_NEEDS_YAML);
    const gate = jobs.find((job) => job.id === "gate");
    expect(gate?.needs).toStrictEqual(["build"]);
  });

  it("インラインフローリストの needs を読める", () => {
    expect.hasAssertions();
    const jobs = extractJobs(INLINE_FLOW_LIST_NEEDS_YAML);
    const gate = jobs.find((job) => job.id === "gate");
    expect(gate?.needs).toStrictEqual(["lint", "test"]);
  });

  it("ブロックリストの needs を読める", () => {
    expect.hasAssertions();
    const jobs = extractJobs(BLOCK_LIST_NEEDS_YAML);
    const gate = jobs.find((job) => job.id === "gate");
    expect(gate?.needs).toStrictEqual(["lint", "test"]);
  });

  it("jobs: が無い場合は空配列を返す", () => {
    expect.hasAssertions();
    expect(extractJobs("on: push\n")).toStrictEqual([]);
  });
});

describe(extractJobBody, () => {
  it("指定した jobId の本文(次のジョブの手前まで)を取り出す", () => {
    expect.hasAssertions();
    const yaml = [
      "jobs:",
      "  lint:",
      "    steps: []",
      "  checks:",
      "    needs: lint",
      "    steps: []",
    ].join("\n");
    expect(extractJobBody(yaml, "checks")).toBe("    needs: lint\n    steps: []");
  });

  it("末尾のジョブなら本文はファイル末尾まで", () => {
    expect.hasAssertions();
    const yaml = ["jobs:", "  solo:", "    steps: []"].join("\n");
    expect(extractJobBody(yaml, "solo")).toBe("    steps: []");
  });

  it("該当する jobId が無ければ undefined を返す", () => {
    expect.hasAssertions();
    expect(extractJobBody("jobs:\n  build:\n    steps: []\n", "missing")).toBeUndefined();
  });

  it("jobs: が無ければ undefined を返す", () => {
    expect.hasAssertions();
    expect(extractJobBody("on: push\n", "build")).toBeUndefined();
  });
});

describe(extractEnvEntries, () => {
  it("env: マッピングの key/value を取り出す", () => {
    expect.hasAssertions();
    const yaml = [
      "jobs:",
      "  build:",
      "    env:",
      "      NODE_ENV: production",
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- GitHub Actions 自身の式構文 `${{ }}` であり、JS のテンプレート文字列ではない。
      "      TOKEN: ${{ secrets.X }}",
    ].join("\n");
    const entries = extractEnvEntries(yaml);
    expect(entries).toStrictEqual([
      { key: "NODE_ENV", rawValue: "production", line: 4 },
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- 同上。
      { key: "TOKEN", rawValue: "${{ secrets.X }}", line: 5 },
    ]);
  });

  it("env: が無いファイルでは空配列を返す", () => {
    expect.hasAssertions();
    expect(extractEnvEntries("jobs:\n  build:\n    steps: []\n")).toStrictEqual([]);
  });
});

describe(extractImageRefs, () => {
  it("image: の参照先を取り出す", () => {
    expect.hasAssertions();
    const yaml = "container:\n  image: node:24.18.1\n";
    expect(extractImageRefs(yaml)).toStrictEqual(["node:24.18.1"]);
  });
});
