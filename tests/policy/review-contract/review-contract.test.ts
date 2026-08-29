import {
  checkReviewContractTokensExistIn,
  extractReviewContractTokens,
} from "./review-contract.check.ts";
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
// tools/architecture の再帰ファイル列挙をそのまま使う(dependency-pin と同じ理由)。
import { walkFiles } from "../../../tools/architecture/src/file-walk.ts";

vi.setConfig({ testTimeout: 5000 });

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function loadFixture(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, relativePath), "utf-8");
}

describe("review-contract: fixture(自己完結)", () => {
  it("aGENTS.md が言及するトークンが workflow に存在すれば違反ゼロ", () => {
    expect.hasAssertions();
    const tokens = extractReviewContractTokens(loadFixture("fixtures/allowed/AGENTS.md"));
    expect(tokens.length).toBeGreaterThan(0);
    const workflow = loadFixture("fixtures/allowed/review-workflow.yml");
    expect(checkReviewContractTokensExistIn("fixture", tokens, workflow)).toStrictEqual([]);
  });

  it("aGENTS.md が言及するトークンが workflow に無ければ違反になる(drift)", () => {
    expect.hasAssertions();
    const tokens = extractReviewContractTokens(loadFixture("fixtures/forbidden/AGENTS.md"));
    const workflow = loadFixture("fixtures/forbidden/review-workflow.yml");
    const violations = checkReviewContractTokensExistIn("fixture", tokens, workflow);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.message).toContain("review-summary");
  });
});

describe("review-contract: 実リポジトリ", () => {
  // tests/policy/**/fixtures/** に置いた AGENTS.md という名前の自己テスト用
  // fixture は、実リポジトリの規範ファイル階層ではないため対象から除く。
  const agentsMdPaths = walkFiles(REPO_ROOT).filter(
    (filePath) =>
      path.basename(filePath) === "AGENTS.md" &&
      !filePath.includes(`${path.sep}tests${path.sep}policy${path.sep}`),
  );

  const workflowsDir = path.join(REPO_ROOT, ".github/workflows");
  let reviewWorkflowFiles: string[] = [];
  try {
    reviewWorkflowFiles = readdirSync(workflowsDir).filter((entry) => /review/iu.test(entry));
  } catch {
    reviewWorkflowFiles = [];
  }
  const reviewWorkflowText = reviewWorkflowFiles
    .map((entry) => readFileSync(path.join(workflowsDir, entry), "utf-8"))
    .join("\n");

  it("aGENTS.md が 0 件で緑になってはいけない(受入条件1)", () => {
    expect.hasAssertions();
    expect(agentsMdPaths.length).toBeGreaterThan(0);
  });

  it("レビュー workflow が 0 件で緑になってはいけない(受入条件1)", () => {
    expect.hasAssertions();
    expect(reviewWorkflowFiles.length).toBeGreaterThan(0);
  });

  it.each(
    agentsMdPaths.map((filePath) => ({ name: path.relative(REPO_ROOT, filePath), filePath })),
  )("$name の「レビュー」節が言及するトークンはレビュー workflow に実在する", ({ filePath }) => {
    expect.hasAssertions();
    const tokens = extractReviewContractTokens(readFileSync(filePath, "utf-8"));
    expect(checkReviewContractTokensExistIn(filePath, tokens, reviewWorkflowText)).toStrictEqual(
      [],
    );
  });
});
