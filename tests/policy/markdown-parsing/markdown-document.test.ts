import { describe, expect, it, vi } from "vitest";

import {
  extractLiteralInlineCodeSpans,
  findSectionsByTitle,
  splitIntoSections,
} from "./markdown-document.ts";

vi.setConfig({ testTimeout: 5000 });

describe(splitIntoSections, () => {
  it("同レベルの見出しごとに本文を分割する(同じレベルの見出しが境界になる)", () => {
    expect.hasAssertions();
    const markdown = ["# 見出し1", "本文1", "# 見出し2", "本文2"].join("\n");
    const sections = splitIntoSections(markdown);
    expect(sections.map((section) => section.title)).toStrictEqual(["見出し1", "見出し2"]);
    expect(sections[0]?.body).toBe("本文1");
    expect(sections[1]?.body).toBe("本文2");
  });

  it("下位見出しは上位見出しの本文に含める", () => {
    expect.hasAssertions();
    const markdown = ["# レビュー", "概要", "## marker", "詳細", "# 次の節", "無関係"].join("\n");
    const sections = splitIntoSections(markdown);
    const review = sections.find((section) => section.title === "レビュー");
    expect(review?.body).toContain("概要");
    expect(review?.body).toContain("詳細");
    expect(review?.body).not.toContain("無関係");
  });
});

describe(findSectionsByTitle, () => {
  it("パターンに一致する見出しのセクションだけを返す", () => {
    expect.hasAssertions();
    const markdown = ["# レビュー契約", "本文A", "# 別の節", "本文B"].join("\n");
    const sections = findSectionsByTitle(markdown, /レビュー/u);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.body).toBe("本文A");
  });
});

describe(extractLiteralInlineCodeSpans, () => {
  it("aSCII のみのトークンを取り出す", () => {
    expect.hasAssertions();
    const text = "PR コメントは `<!-- review-summary -->` で marker upsert する。";
    expect(extractLiteralInlineCodeSpans(text)).toStrictEqual(["<!-- review-summary -->"]);
  });

  it("日本語を含むインラインコードは説明文として除外する", () => {
    expect.hasAssertions();
    const text = "`ここは説明文` と `ACTUAL_TOKEN` がある。";
    expect(extractLiteralInlineCodeSpans(text)).toStrictEqual(["ACTUAL_TOKEN"]);
  });
});
