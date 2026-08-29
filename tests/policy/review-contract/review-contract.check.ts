/**
 * 原則4(機械強制)/ §5「policy-as-test」の「レビュー契約」検証。
 * 「AGENTS.md とレビュー workflow の文言が一致すること」を機械判定する。
 *
 * spec はこの一致の具体的な判定方法までは定めていない(推測で埋めない、
 * report に明記する、という方針に従い、ここで判定方法を決めて明記する)。
 *
 * 採った方法: AGENTS.md(または nested AGENTS.md)の中で見出しが「レビュー」
 * を含むセクションから、インラインコード( `` `token` `` )のうち固有の値
 * (ASCII のみで構成される、マーカー文字列・設定値等)を抜き出す。抜き出した
 * トークンが 1 つでもレビュー workflow の内容に存在しなければ、
 * 「AGENTS.md がレビュー workflow の実装について書いている内容が、実際の
 * workflow に存在しない」という drift として違反にする。
 *
 * 一方向(AGENTS.md → workflow)だけを見る。逆方向(workflow の中の任意の
 * リテラルが AGENTS.md に無ければ違反、という判定)は workflow が持つ
 * リテラルの大半(job 名・action バージョン等)が本来ドキュメント化対象では
 * ないため、ノイズが大きすぎると判断して採らない(report に明記)。
 */
import {
  extractLiteralInlineCodeSpans,
  findSectionsByTitle,
} from "../markdown-parsing/markdown-document.ts";
import type { PolicyViolation } from "../violation.ts";

const REVIEW_HEADING = /レビュー/u;

function extractReviewContractTokens(agentsMdText: string): string[] {
  const sections = findSectionsByTitle(agentsMdText, REVIEW_HEADING);
  const tokens = new Set<string>();
  for (const section of sections) {
    for (const token of extractLiteralInlineCodeSpans(section.body)) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

function checkReviewContractTokensExistIn(
  source: string,
  tokens: readonly string[],
  reviewWorkflowText: string,
): PolicyViolation[] {
  return tokens
    .filter((token) => !reviewWorkflowText.includes(token))
    .map((token) => ({
      source,
      message: `AGENTS.md の「レビュー」節が言及する "${token}" が、レビュー workflow の中に見つからない(drift)`,
    }));
}

export { extractReviewContractTokens, checkReviewContractTokensExistIn };
