/**
 * 原則4(機械強制)/ §4「機械強制」表の「意図的にミスマッチさせた `.feature` /
 * spec が構造的に落ちること」の検証。
 *
 * `.feature` と spec の対応そのものを判定するルール(feature-spec-pairing)は
 * tools/architecture が持ち、tools/architecture/test/checker.test.ts が
 * ルール単体の正しさを fixture で検証している(そちらは他エージェントの
 * 担当であり、ここで重複させない)。
 *
 * ここ(policy-as-test)の役割はレイヤが違う: 「ルールが正しいか」ではなく、
 * 「そのルールが実際の検証パイプライン(`mise run check:architecture` が
 * 呼ぶ checker の CLI 実行)に組み込まれていて、ミスマッチが起きたときに
 * **プロセスの終了コードとして**落ちるか」を、公開契約(CLI の観測可能な
 * 振る舞い = 終了コード)だけを見て検証する(原則6「テスト対象は公開契約と
 * 外部から観測可能な振る舞いのみ」)。checker の内部関数を import して直接
 * 呼ぶのではなく、実際に `node tools/architecture/src/checker.ts <dir>` を
 * 子プロセスとして起動する。
 */
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

vi.setConfig({ testTimeout: 5000 });

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CHECKER_ENTRYPOINT = path.join(REPO_ROOT, "tools/architecture/src/checker.ts");

/**
 * checker CLI を 1 回起動した結果。このテストが見る公開契約はこの 2 つだけ
 * （終了コードと、混ぜた標準出力・標準エラー）。`status` の null は
 * シグナルで殺された場合を表す spawnSync 側の表現をそのまま持つ。
 */
interface CheckerRun {
  readonly status: number | null;
  readonly output: string;
}

function runChecker(rootDir: string): CheckerRun {
  const result = spawnSync(process.execPath, [CHECKER_ENTRYPOINT, rootDir], {
    encoding: "utf-8",
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

// テスト固有の一時ディレクトリを作り、テスト本体を実行した後に必ず削除する。
// afterEach + 共有のモジュールスコープ変数（vitest/no-hooks が問題にする形）を
// 避け、各テストが自分の一時ディレクトリの生成と削除を閉じた形で持つ。
function withTempFixtureDir(run: (tempDir: string) => void): void {
  const tempDir = mkdtempSync(path.join(tmpdir(), "policy-gherkin-drift-"));
  try {
    run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("gherkin-drift: .feature と spec のミスマッチが checker CLI を落とす", () => {
  it("spec を持たない .feature を置くと、checker CLI が非ゼロ終了する", () => {
    expect.hasAssertions();
    withTempFixtureDir((tempDir) => {
      const featureDir = path.join(tempDir, "apps/fixture-app/src/features/sample");
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(
        path.join(featureDir, "sample.feature"),
        `${["Feature: サンプル", "  Scenario: 対応する spec が無い", "    Given 前提"].join("\n")}\n`,
      );

      const result = runChecker(tempDir);

      expect(result.status).not.toBe(0);
      expect(result.output).toContain("feature-spec-pairing");
    });
  });

  it("spec が正しく .feature を参照していれば、checker CLI は成功終了する(比較対象)", () => {
    expect.hasAssertions();
    withTempFixtureDir((tempDir) => {
      const featureDir = path.join(tempDir, "apps/fixture-app/src/features/sample");
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(
        path.join(featureDir, "sample.feature"),
        `${["Feature: サンプル", "  Scenario: 対応する spec がある", "    Given 前提"].join("\n")}\n`,
      );
      writeFileSync(
        path.join(featureDir, "sample.spec.ts"),
        `${['const featurePath = "./sample.feature";', "export {};"].join("\n")}\n`,
      );

      const result = runChecker(tempDir);

      expect(result.status).toBe(0);
      expect(result.output).not.toContain("feature-spec-pairing");
    });
  });
});
