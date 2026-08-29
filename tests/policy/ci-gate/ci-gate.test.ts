import {
  type WorkflowFile,
  checkGateStructure,
  checkMatrixDependsSync,
  hasMultiJobWorkflow,
  parseWorkflowFile,
} from "./ci-gate.check.ts";
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { extractTaskDepends } from "../manifest-parsing/mise-tasks.ts";
import { extractMatrixTaskList } from "../workflow-parsing/github-actions-matrix.ts";
import { extractJobBody } from "../workflow-parsing/github-actions-workflow.ts";
import path from "node:path";

vi.setConfig({ testTimeout: 5000 });

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github/workflows");

function loadWorkflowFiles(dir: string): WorkflowFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .map((entry) => {
      const filePath = path.join(dir, entry);
      return parseWorkflowFile(filePath, readFileSync(filePath, "utf-8"));
    });
}

function loadFixture(relativePath: string): WorkflowFile {
  const filePath = path.join(import.meta.dirname, relativePath);
  return parseWorkflowFile(filePath, readFileSync(filePath, "utf-8"));
}

describe("ci-gate: fixture(自己完結。他エージェントの成果物に依存しない)", () => {
  it("全ジョブが単一のルート(ゲート)に依存している workflow は違反ゼロ", () => {
    expect.hasAssertions();
    const file = loadFixture("fixtures/allowed/gated.yml");
    expect(checkGateStructure(file)).toStrictEqual([]);
  });

  it("needs を持たないジョブが 2 個ある(ゲートを迂回できる) workflow は違反になる", () => {
    expect.hasAssertions();
    const file = loadFixture("fixtures/forbidden/bypassed-job.yml");
    const violations = checkGateStructure(file);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.message).toContain("deploy");
  });

  it("needs が存在しないジョブ ID を指している workflow は違反になる", () => {
    expect.hasAssertions();
    const file = loadFixture("fixtures/forbidden/dangling-needs.yml");
    const violations = checkGateStructure(file);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.message).toContain("deploy");
  });

  it("ジョブが 1 個以下の workflow は無条件で違反ゼロ(迂回できる他ジョブが無い)", () => {
    expect.hasAssertions();
    const file: WorkflowFile = { path: "single-job.yml", jobs: [{ id: "solo", needs: [] }] };
    expect(checkGateStructure(file)).toStrictEqual([]);
  });
});

describe("ci-gate: 実リポジトリ(.github/workflows/*.yml を対象にする)", () => {
  const files = loadWorkflowFiles(WORKFLOWS_DIR);

  it("対象ファイルが 0 件で緑になってはいけない(受入条件1)", () => {
    expect.hasAssertions();
    expect(files.length).toBeGreaterThan(0);
  });

  it("ゲート構造そのものが検証される workflow(ジョブが 2 個以上)が最低 1 つ存在する", () => {
    expect.hasAssertions();
    // 全ファイルがジョブ 1 個しか持たない場合、checkGateStructure は
    // 常に [] を返して空振りする。それを防ぐための前提チェック。
    expect(hasMultiJobWorkflow(files)).toBe(true);
  });

  it.each(files.map((file) => ({ name: path.basename(file.path), file })))(
    "$name: 他の全ジョブがゲートに needs で(直接・間接に)依存している",
    ({ file }) => {
      expect.hasAssertions();
      expect(checkGateStructure(file)).toStrictEqual([]);
    },
  );
});

describe("ci-gate: matrix ⇔ check.depends 同期(fixture。自己完結)", () => {
  it("完全一致していれば違反ゼロ", () => {
    expect.hasAssertions();
    expect(checkMatrixDependsSync(["lint", "fmt"], ["lint", "fmt"])).toStrictEqual([]);
  });

  it("depends にだけあるタスクは missing-in-matrix として報告される", () => {
    expect.hasAssertions();
    const violations = checkMatrixDependsSync(["lint", "fmt"], ["lint"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("fmt");
  });

  it("matrix にだけあるタスクは missing-in-depends として報告される", () => {
    expect.hasAssertions();
    const violations = checkMatrixDependsSync(["lint"], ["lint", "fmt"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("fmt");
  });

  it("両方向にズレがあれば両方とも報告される(片方で早期returnしない)", () => {
    expect.hasAssertions();
    const violations = checkMatrixDependsSync(
      ["lint", "only-in-depends"],
      ["lint", "only-in-matrix"],
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]?.message).toContain("only-in-depends");
    expect(violations[1]?.message).toContain("only-in-matrix");
  });

  it("両方空なら違反ゼロ", () => {
    expect.hasAssertions();
    expect(checkMatrixDependsSync([], [])).toStrictEqual([]);
  });
});

describe("ci-gate: 実リポジトリ(mise.toml の [tasks.check].depends と ci.yml の matrix.task)", () => {
  const miseTomlPath = path.join(REPO_ROOT, "mise.toml");
  const ciYamlPath = path.join(WORKFLOWS_DIR, "ci.yml");

  const dependsTasks = extractTaskDepends(readFileSync(miseTomlPath, "utf-8"), "check");
  const checksJobBody = extractJobBody(readFileSync(ciYamlPath, "utf-8"), "checks");
  const matrixTasks = checksJobBody === undefined ? [] : extractMatrixTaskList(checksJobBody);

  it("[tasks.check].depends が 0 件で緑になってはいけない(受入条件1)", () => {
    expect.hasAssertions();
    expect(dependsTasks.length).toBeGreaterThan(0);
  });

  it("checks ジョブの matrix.task が 0 件で緑になってはいけない(受入条件1)", () => {
    expect.hasAssertions();
    expect(matrixTasks.length).toBeGreaterThan(0);
  });

  it("[tasks.check].depends と matrix.task が集合として完全一致している", () => {
    expect.hasAssertions();
    expect(checkMatrixDependsSync(dependsTasks, matrixTasks)).toStrictEqual([]);
  });
});
