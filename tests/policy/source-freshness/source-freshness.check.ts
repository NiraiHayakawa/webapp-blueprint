/**
 * 原則11(知見の還流)/ §5「policy-as-test」の「正本の鮮度」検証。
 *
 * ① 実在性: 正本(決定ログ・現行規範。原則11 の定義どおり AGENTS.md 階層と
 *    ADR を指す)が言及するパス・コマンドが実在すること
 * ② 同期: 同一 PR 内で参照先が変わったのに正本が触られていないこと
 *
 * 「パス・コマンド」の抜き出し方は spec に明記が無いため、ここで定義する
 * (report に明記する)。インラインコード( `` `token` `` )のうち:
 * - `mise run <task>` の形をしているものは、mise.toml の `[tasks.<task>]`
 *   の実在を見る(このリポジトリの「検証は 1 コマンド」規約(原則8)に
 *   合わせ、コマンド参照はまず mise task に絞る。裸の pnpm/npx 呼び出し等の
 *   ドキュメント内コマンドは対象外にする、という判断を report に明記する)
 * - スラッシュを含む、または既知の拡張子で終わるものはリポジトリルートから
 *   の相対パスとして実在を見る
 *
 * 実リポジトリへの適用範囲(source-freshness.test.ts)は AGENTS.md 階層のみ。
 * docs/recipes/ は対象外(§6「その他のレシピ」が明言するとおり、採用される
 * までは実在しないパスを書くことが設計上正しいレシピ層のため。整合性検証
 * (2026-08-08)で docs/recipes/ 全 7 ファイルが偽陽性で落ちることを確認して
 * 除外した。詳細は source-freshness.test.ts のコメント参照)。
 *
 * ②「同期」(checkSyncOnDiff)の実 PR への配線は scripts/check-source-sync.mjs
 * (mise.toml [tasks."check:source-sync"] / .github/workflows/ci.yml の
 * source-sync job から呼ばれる。監査 2026-08-08 で「ロジックはあるが実際の
 * PR では発火しない」と指摘され、この配線を追加した)。
 */
import type { PolicyViolation } from "../violation.ts";
import { extractLiteralInlineCodeSpans } from "../markdown-parsing/markdown-document.ts";

const MISE_RUN_PATTERN = /^mise run "?(?<taskName>[\w:-]+)"?$/u;
const PATH_LIKE_SUFFIX = /\.(?<extension>md|ts|tsx|js|mjs|json|jsonc|yml|yaml|toml|sh|pkl)$/u;

function isPathLikeToken(token: string): boolean {
  if (MISE_RUN_PATTERN.test(token)) {
    return false;
  }
  if (token.includes(" ")) {
    // コマンド列らしきものはパスとして扱わない
    return false;
  }
  if (token.startsWith("$") || token.startsWith("<") || token.startsWith("op://")) {
    return false;
  }
  return token.includes("/") || PATH_LIKE_SUFFIX.test(token);
}

function extractPathTokens(markdownText: string): string[] {
  return extractLiteralInlineCodeSpans(markdownText).filter((token) => isPathLikeToken(token));
}

function extractMiseTaskTokens(markdownText: string): string[] {
  const tasks: string[] = [];
  for (const token of extractLiteralInlineCodeSpans(markdownText)) {
    const match = MISE_RUN_PATTERN.exec(token);
    if (match?.[1] !== undefined) {
      tasks.push(match[1]);
    }
  }
  return tasks;
}

/** mise.toml の `[tasks.<name>]` / `[tasks."<name>"]` 見出しをすべて抜き出す。 */
function extractMiseTaskNames(miseTomlText: string): Set<string> {
  const names = new Set<string>();
  const pattern = /^\[tasks\.(?:"(?<quotedName>[^"]+)"|(?<bareName>[\w-]+))\]/gmu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(miseTomlText)) !== null) {
    const name = match[1] ?? match[2];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

function checkPathTokensExist(
  source: string,
  tokens: readonly string[],
  pathExists: (token: string) => boolean,
): PolicyViolation[] {
  return tokens
    .filter((token) => !pathExists(token))
    .map((token) => ({ source, message: `"${token}" が指すパスが実在しない` }));
}

function checkMiseTaskTokensExist(
  source: string,
  tokens: readonly string[],
  knownTasks: ReadonlySet<string>,
): PolicyViolation[] {
  return tokens
    .filter((token) => !knownTasks.has(token))
    .map((token) => ({
      source,
      message: `"mise run ${token}" が参照する task が mise.toml に存在しない`,
    }));
}

interface DocReference {
  readonly docPath: string;
  readonly referencedPaths: readonly string[];
}

/**
 * 同一 PR 内で参照先が変わったのに正本が触られていない場合を検出する
 * (原則11 ②「同期」)。`changedFiles` は diff で変更されたファイルパスの集合
 * (docPath・referencedPaths と同じ形式のパス文字列で正規化されていることを
 * 前提にする)。
 */
function checkSyncOnDiff(
  changedFiles: ReadonlySet<string>,
  referencingDocs: readonly DocReference[],
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const doc of referencingDocs) {
    if (changedFiles.has(doc.docPath)) {
      // 正本自体も変更されている
      continue;
    }
    for (const referencedPath of doc.referencedPaths) {
      if (changedFiles.has(referencedPath)) {
        violations.push({
          source: doc.docPath,
          message: `参照先 "${referencedPath}" が同一 PR 内で変更されているが、それを参照する正本 "${doc.docPath}" は変更されていない`,
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// checkSyncOnDiff を実 git diff / 実リポジトリに配線するための純粋ヘルパー。
// (監査 2026-08-08 で発見: checkSyncOnDiff 自体はここまでの fixture テストで
// 検証されているが、実際の PR ではどこからも呼ばれていなかった。実行系
// (git subprocess・fs 読み込み・process.exit)は scripts/check-source-sync.mjs
// に置き、そこから呼ばれる純粋関数だけをここに置く— checkPathTokensExist が
// `pathExists` を注入で受け取るのと同じ設計に合わせている)。
// ---------------------------------------------------------------------------

/**
 * `git diff --name-only <base> <head>` の標準出力をパースし、変更された
 * ファイルパスの集合を作る。空行(末尾改行・連続改行)は無視する。
 */
function parseChangedFilesOutput(diffOutput: string): Set<string> {
  return new Set(
    diffOutput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

interface RawDoc {
  readonly docPath: string;
  readonly text: string;
}

/**
 * (docPath, 生テキスト)の組から DocReference[] を作る。ファイル読み込み
 * (fs)は呼び出し側の責務にし、ここはテキストから参照先を抽出するだけの
 * 純粋関数に留める。
 */
function buildReferencingDocs(docs: readonly RawDoc[]): DocReference[] {
  return docs.map((doc) => ({
    docPath: doc.docPath,
    referencedPaths: extractPathTokens(doc.text),
  }));
}

export {
  extractPathTokens,
  extractMiseTaskTokens,
  extractMiseTaskNames,
  checkPathTokensExist,
  checkMiseTaskTokensExist,
  checkSyncOnDiff,
  parseChangedFilesOutput,
  buildReferencingDocs,
};
export type { DocReference, RawDoc };
