/**
 * §7「AI ハーネス」/「コンテキスト予算」の機械強制。
 * ルート `AGENTS.md` が行数上限を超えていないことを検証する。
 *
 * 上限値は spec に明記が無いため、ここで定義し理由を書く(report にも明記する)。
 *
 * 200 行を上限にする。理由: §7 は AGENTS.md が持つ節を
 * 「絶対規約」「Stack 索引」「コマンド」「スキル参照」「現在の状態」の
 * 5 節に絞っている。各節を 30〜40 行程度(見出し・数行の説明・箇条書き
 * 10 項目前後)に収めれば 5 節で 150〜200 行に収まる。「常時ロード枠は
 * 最も希少」という §7 の前提を体現するため、余裕を持たせず 200 行を
 * 固定の上限にする(超えたら nested AGENTS.md か docs/ への退避を検討する
 * シグナルにする)。
 */

import type { PolicyViolation } from "../violation.ts";

const ROOT_AGENTS_MD_LINE_LIMIT = 200;

function countLines(text: string): number {
  if (text === "") {
    return 0;
  }
  // 末尾の改行 1 個は「最後の行の終端」であり、行数に数えない。
  let withoutTrailingNewline = text;
  if (text.endsWith("\n")) {
    withoutTrailingNewline = text.slice(0, -1);
  }
  return withoutTrailingNewline.split("\n").length;
}

function checkLineLimit(source: string, text: string, limit: number): PolicyViolation[] {
  const lineCount = countLines(text);
  if (lineCount <= limit) {
    return [];
  }
  return [
    {
      source,
      message: `${lineCount} 行あり、上限の ${limit} 行を超えている(常時ロードされる枠を消費しすぎている。docs/ への退避を検討する)`,
    },
  ];
}

export { ROOT_AGENTS_MD_LINE_LIMIT, countLines, checkLineLimit };
