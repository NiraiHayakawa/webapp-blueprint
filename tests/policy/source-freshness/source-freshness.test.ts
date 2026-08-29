import {
  buildReferencingDocs,
  checkMiseTaskTokensExist,
  checkPathTokensExist,
  checkSyncOnDiff,
  extractMiseTaskNames,
  extractMiseTaskTokens,
  extractPathTokens,
  parseChangedFilesOutput,
} from "./source-freshness.check.ts";
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// tools/architecture の再帰ファイル列挙をそのまま使う(dependency-pin と同じ理由)。
import { walkFiles } from "../../../tools/architecture/src/file-walk.ts";

vi.setConfig({ testTimeout: 5000 });

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const TESTS_POLICY_PREFIX = `${path.sep}tests${path.sep}policy${path.sep}`;

function loadFixture(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, relativePath), "utf-8");
}

describe("source-freshness: 実在性チェック(fixture。自己完結)", () => {
  it("実在するパス・mise task を参照する正本は違反ゼロ", () => {
    expect.hasAssertions();
    const text = loadFixture("fixtures/allowed/AGENTS.md");
    const pathTokens = extractPathTokens(text);
    const taskTokens = extractMiseTaskTokens(text);
    expect(pathTokens.length).toBeGreaterThan(0);
    expect(taskTokens.length).toBeGreaterThan(0);

    const pathViolations = checkPathTokensExist(
      "fixture",
      pathTokens,
      (token) => token === "docs/plan/Template/20260807_template-design.md",
    );
    const taskViolations = checkMiseTaskTokensExist("fixture", taskTokens, new Set(["check"]));
    expect(pathViolations).toStrictEqual([]);
    expect(taskViolations).toStrictEqual([]);
  });

  it("実在しないパス・mise task を参照する正本は違反になる", () => {
    expect.hasAssertions();
    const text = loadFixture("fixtures/forbidden/AGENTS.md");
    const pathTokens = extractPathTokens(text);
    const taskTokens = extractMiseTaskTokens(text);

    const pathViolations = checkPathTokensExist("fixture", pathTokens, () => false);
    const taskViolations = checkMiseTaskTokensExist("fixture", taskTokens, new Set(["check"]));
    expect(pathViolations.length).toBeGreaterThan(0);
    expect(taskViolations.length).toBeGreaterThan(0);
  });
});

describe("source-freshness: 同期チェック(fixture。自己完結)", () => {
  it("参照先が変更され、正本も同じ diff で変更されていれば違反ゼロ", () => {
    expect.hasAssertions();
    const changedFiles = new Set(["AGENTS.md", "mise.toml"]);
    const violations = checkSyncOnDiff(changedFiles, [
      { docPath: "AGENTS.md", referencedPaths: ["mise.toml"] },
    ]);
    expect(violations).toStrictEqual([]);
  });

  it("参照先だけが変更され、正本が変更されていなければ違反になる(原則11②)", () => {
    expect.hasAssertions();
    const changedFiles = new Set(["mise.toml"]);
    const violations = checkSyncOnDiff(changedFiles, [
      { docPath: "AGENTS.md", referencedPaths: ["mise.toml"] },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("mise.toml");
  });
});

describe("source-freshness: 同期チェックの実配線ヘルパー(fixture。自己完結)", () => {
  // scripts/check-source-sync.mjs が実行する git subprocess / fs 読み込みを
  // 直接テストするのではなく、その両端をつなぐ純粋関数(parseChangedFilesOutput /
  // buildReferencingDocs)だけをここで検証する。git subprocess 自体の呼び出しは
  // 「ロジック」ではなく IO であり、原則6(公開契約のみテスト)の対象外。

  it("parseChangedFilesOutput は git diff --name-only の出力を行ごとの集合にする", () => {
    expect.hasAssertions();
    const output = "AGENTS.md\nmise.toml\n";
    expect(parseChangedFilesOutput(output)).toStrictEqual(new Set(["AGENTS.md", "mise.toml"]));
  });

  it("parseChangedFilesOutput は空行・空文字列を無視する(差分が無い場合に空集合になる)", () => {
    expect.hasAssertions();
    expect(parseChangedFilesOutput("")).toStrictEqual(new Set());
    expect(parseChangedFilesOutput("\n\n")).toStrictEqual(new Set());
  });

  it("buildReferencingDocs は各 doc のテキストから参照パスだけを抽出する", () => {
    expect.hasAssertions();
    const docs = buildReferencingDocs([
      { docPath: "AGENTS.md", text: "正本は `mise.toml`。" },
      { docPath: "apps/web/AGENTS.md", text: "参照なし。" },
    ]);
    expect(docs).toStrictEqual([
      { docPath: "AGENTS.md", referencedPaths: ["mise.toml"] },
      { docPath: "apps/web/AGENTS.md", referencedPaths: [] },
    ]);
  });

  it("実配線の合成(parse → build → checkSyncOnDiff)が参照先だけの変更で実際に赤くなる(原則11②)", () => {
    expect.hasAssertions();
    // scripts/check-source-sync.mjs が本番で組み立てる引数を、git subprocess /
    // fs の代わりに手元の文字列で再現する。三者の合成が壊れていないことを
    // 確認する目的であり、checkSyncOnDiff 自身のロジックは再検証しない。
    const changedFiles = parseChangedFilesOutput("mise.toml\n");
    const referencingDocs = buildReferencingDocs([
      { docPath: "AGENTS.md", text: "コマンドの正本は `mise.toml`。" },
    ]);
    const violations = checkSyncOnDiff(changedFiles, referencingDocs);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("mise.toml");
  });
});

// 対象は AGENTS.md 階層(root + nested)のみに絞る。
//
// 整合性検証(2026-08-08)で発見・修正した事実: 元の実装は docs/recipes/ も
// スキャン対象にしていたが、docs/recipes/**/*.md を実行して確認すると
// 7 ファイル全てが偽陽性で落ちた(`@hey-api/openapi-ts` のような npm
// パッケージ名や、`contract/typespec/` のような「レシピを採用したときに
// 作る」将来のパスまで「実在しないパス」として検出してしまう)。
//
// 原則11(knowledge-flows-back.md)は検査対象を「正本(決定ログ・現行規範)」
// と明記しており、この語はファイル全文で一貫して ADR(決定ログ)と
// AGENTS.md 階層(現行規範)だけを指す。docs/recipes/ は三層構造(§1)の
// 「レシピ層」であり、§6「その他のレシピ」が明言するとおり
// 「実体層には配線しない(clone直後は動かない)」= 採用されるまで実在しない
// パスを書くことが設計上正しい。「正本が言及するパスは実在する」という
// 本検査の前提と構造的に噛み合わないため、対象から外す
// (docs/adr/README.md も同じ理由で対象外: ADR テンプレートの記載例が
// 同種の偽陽性を出す。ADR 本体(NNNN-*.md)はまだ存在しない)。
function isSourceOfTruthAgentsMdPath(filePath: string): boolean {
  if (filePath.includes(TESTS_POLICY_PREFIX)) {
    // 自己テスト用 fixture を除く
    return false;
  }
  return path.basename(filePath) === "AGENTS.md";
}

describe("source-freshness: 実リポジトリ(AGENTS.md 階層)", () => {
  const sourceOfTruthPaths = walkFiles(REPO_ROOT).filter((filePath) =>
    isSourceOfTruthAgentsMdPath(filePath),
  );

  it("対象の正本ファイルが 0 件で緑になってはいけない(受入条件1)", () => {
    expect.hasAssertions();
    expect(sourceOfTruthPaths.length).toBeGreaterThan(0);
  });

  const miseTaskNames = extractMiseTaskNames(
    readFileSync(path.join(REPO_ROOT, "mise.toml"), "utf-8"),
  );

  it.each(
    sourceOfTruthPaths.map((filePath) => ({ name: path.relative(REPO_ROOT, filePath), filePath })),
  )("$name が言及するパス・mise task は実在する", ({ filePath }) => {
    expect.hasAssertions();
    const text = readFileSync(filePath, "utf-8");
    const pathViolations = checkPathTokensExist(filePath, extractPathTokens(text), (token) =>
      existsSync(path.join(REPO_ROOT, token)),
    );
    const taskViolations = checkMiseTaskTokensExist(
      filePath,
      extractMiseTaskTokens(text),
      miseTaskNames,
    );
    expect(pathViolations).toStrictEqual([]);
    expect(taskViolations).toStrictEqual([]);
  });
});
