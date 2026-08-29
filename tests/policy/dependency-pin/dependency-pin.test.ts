import {
  checkImagePins,
  checkSpecifiers,
  isPinnedImageRef,
  isRangeSpecifier,
} from "./dependency-pin.check.ts";
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { extractCatalogSpecifiers } from "../manifest-parsing/pnpm-workspace-catalog.ts";
import { extractImageRefs } from "../workflow-parsing/github-actions-workflow.ts";
import { extractLockfileSpecifiers } from "../manifest-parsing/pnpm-lockfile.ts";
import { extractManifestSpecifiers } from "../manifest-parsing/package-manifest.ts";
import path from "node:path";
// tools/architecture が既に持つ再帰ファイル列挙をそのまま使う。同じロジックを
// tests/policy 側に再実装すると similarity-ts の重複検出（§5）に引っかかる
// ため、意図的に import で再利用する（tools/architecture のファイルは編集しない）。
import { walkFiles } from "../../../tools/architecture/src/file-walk.ts";

vi.setConfig({ testTimeout: 5000 });

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SHA256_HEX_LENGTH = 64;

describe("dependency-pin: fixture（自己完結）", () => {
  it("完全 pin された specifier は違反にならない", () => {
    expect.hasAssertions();
    expect(checkSpecifiers("fixture", [{ name: "typescript", specifier: "7.0.2" }])).toStrictEqual(
      [],
    );
  });

  it.each([
    { name: "caret", specifier: "^1.2.3" },
    { name: "tilde", specifier: "~1.2.3" },
    { name: "wildcard", specifier: "*" },
    { name: "latest", specifier: "latest" },
  ])("$name レンジ（$specifier）は違反になる", ({ specifier }) => {
    expect.hasAssertions();
    const violations = checkSpecifiers("fixture", [{ name: "left-pad", specifier }]);
    expect(violations).toHaveLength(1);
  });

  it("catalog: は自己参照の印であり違反にならない", () => {
    expect.hasAssertions();
    expect(isRangeSpecifier("catalog:")).toBe(false);
  });

  it("digest 固定のコンテナイメージは違反にならない", () => {
    expect.hasAssertions();
    const image = `node@sha256:${"a".repeat(SHA256_HEX_LENGTH)}`;
    expect(isPinnedImageRef(image)).toBe(true);
    expect(checkImagePins("fixture", [image])).toStrictEqual([]);
  });

  it("タグ固定のコンテナイメージは違反にならない", () => {
    expect.hasAssertions();
    expect(isPinnedImageRef("node:24.18.1")).toBe(true);
  });

  it.each([
    { name: "latest タグ", image: "node:latest" },
    { name: "タグ省略", image: "node" },
  ])("$name のコンテナイメージは違反になる", ({ image }) => {
    expect.hasAssertions();
    expect(isPinnedImageRef(image)).toBe(false);
    expect(checkImagePins("fixture", [image])).toHaveLength(1);
  });
});

describe("dependency-pin: 実リポジトリ（package.json / pnpm-workspace.yaml / pnpm-lock.yaml）", () => {
  const packageJsonPaths = walkFiles(REPO_ROOT).filter((filePath) =>
    filePath.endsWith("package.json"),
  );

  it("対象の package.json が 0 件で緑になってはいけない（受入条件1）", () => {
    expect.hasAssertions();
    expect(packageJsonPaths.length).toBeGreaterThan(0);
  });

  it.each(
    packageJsonPaths.map((filePath) => ({ name: path.relative(REPO_ROOT, filePath), filePath })),
  )("$name の依存 specifier にレンジ指定が無い", ({ filePath }) => {
    expect.hasAssertions();
    const specifiers = extractManifestSpecifiers(readFileSync(filePath, "utf-8"));
    expect(checkSpecifiers(filePath, specifiers)).toStrictEqual([]);
  });

  it("pnpm-workspace.yaml の catalog specifier にレンジ指定が無い", () => {
    expect.hasAssertions();
    const catalogPath = path.join(REPO_ROOT, "pnpm-workspace.yaml");
    const specifiers = extractCatalogSpecifiers(readFileSync(catalogPath, "utf-8"));
    expect(specifiers.length).toBeGreaterThan(0);
    expect(checkSpecifiers(catalogPath, specifiers)).toStrictEqual([]);
  });

  it("pnpm-lock.yaml の specifier にレンジ指定が無い", () => {
    expect.hasAssertions();
    const lockfilePath = path.join(REPO_ROOT, "pnpm-lock.yaml");
    const specifiers = extractLockfileSpecifiers(readFileSync(lockfilePath, "utf-8")).map(
      (entry) => ({
        name: entry.path.join("."),
        specifier: entry.specifier,
      }),
    );
    expect(specifiers.length).toBeGreaterThan(0);
    expect(checkSpecifiers(lockfilePath, specifiers)).toStrictEqual([]);
  });
});

describe("dependency-pin: 実リポジトリ（.github/workflows のコンテナイメージ pin）", () => {
  it("workflow が参照するコンテナイメージは digest かタグで固定されている（0 件は許容: コンテナを使わない workflow もあるため）", () => {
    expect.hasAssertions();
    const workflowsDir = path.join(REPO_ROOT, ".github/workflows");
    let entries: string[] = [];
    try {
      entries = readdirSync(workflowsDir).filter(
        (entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"),
      );
    } catch {
      entries = [];
    }
    const images = entries.flatMap((entry) =>
      extractImageRefs(readFileSync(path.join(workflowsDir, entry), "utf-8")),
    );
    expect(checkImagePins(workflowsDir, images)).toStrictEqual([]);
  });
});
