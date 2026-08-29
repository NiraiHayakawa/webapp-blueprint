import {
  checkEnvExampleValues,
  checkWorkflowEnvValues,
  parseEnvExample,
} from "./secret-reference.check.ts";
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { extractEnvEntries } from "../workflow-parsing/github-actions-workflow.ts";
import path from "node:path";

vi.setConfig({ testTimeout: 5000 });

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function loadFixture(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, relativePath), "utf-8");
}

describe("secret-reference: fixture（自己完結）", () => {
  it("op:// 参照のみの .env.example は違反ゼロ", () => {
    expect.hasAssertions();
    const entries = parseEnvExample(loadFixture("fixtures/allowed/.env.example"));
    expect(entries.length).toBeGreaterThan(0);
    expect(checkEnvExampleValues("fixture", entries)).toStrictEqual([]);
  });

  it("op:// 参照以外の値を持つ .env.example は違反になる", () => {
    expect.hasAssertions();
    const entries = parseEnvExample(loadFixture("fixtures/forbidden/.env.example"));
    const violations = checkEnvExampleValues("fixture", entries);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("SAMPLE_API_KEY");
  });

  it("式・短い設定値だけの env: は違反ゼロ", () => {
    expect.hasAssertions();
    const entries = extractEnvEntries(loadFixture("fixtures/allowed/workflow.yml"));
    expect(entries.length).toBeGreaterThan(0);
    expect(checkWorkflowEnvValues("fixture", entries)).toStrictEqual([]);
  });

  it("平文の env: は違反になる", () => {
    expect.hasAssertions();
    const entries = extractEnvEntries(loadFixture("fixtures/forbidden/workflow.yml"));
    const violations = checkWorkflowEnvValues("fixture", entries);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("SAMPLE_TOKEN");
  });
});

describe("secret-reference: 実リポジトリ", () => {
  it(".env.example が op:// 参照以外の値を含まない（受入条件8）", () => {
    expect.hasAssertions();
    const envExamplePath = path.join(REPO_ROOT, ".env.example");
    const entries = parseEnvExample(readFileSync(envExamplePath, "utf-8"));
    expect(entries.length).toBeGreaterThan(0);
    expect(checkEnvExampleValues(envExamplePath, entries)).toStrictEqual([]);
  });

  it("workflow の env: に平文が無い（0 件は許容: env: を持たない workflow もあるため）", () => {
    expect.hasAssertions();
    const workflowsDir = path.join(REPO_ROOT, ".github/workflows");
    let files: string[] = [];
    try {
      files = readdirSync(workflowsDir).filter(
        (entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"),
      );
    } catch {
      files = [];
    }
    for (const file of files) {
      const filePath = path.join(workflowsDir, file);
      const entries = extractEnvEntries(readFileSync(filePath, "utf-8"));
      expect(checkWorkflowEnvValues(filePath, entries)).toStrictEqual([]);
    }
  });
});
