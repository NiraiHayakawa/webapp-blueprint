import { z } from "zod";

// pre-tool-use.test.ts と run-hook.test.ts の両方が検証する「PreToolUse hook
// の拒否出力の形」を1箇所にまとめる。similarity-ts の type-literal 重複検出
// （design §5「similarity-ts（重複検出）」）が指摘した通り、両ファイルが
// 同じ形の匿名戻り値型を持つ同名関数を個別に持っていたのは偶然の類似では
// なく同じ知識（公式ドキュメント https://code.claude.com/docs/en/hooks が
// 示す deny の形そのもの）の重複だったため、共通化した。
//
// 手書きの検証からスキーマに移したのは、この形が「公式ドキュメントが定めた
// 外部との契約」そのものであり、宣言として一目で読めるほうが、何を hook の
// 公開契約として固定しているかが分かるため。z.looseObject にしているのは、
// Claude Code 側が将来フィールドを足したときにテストが落ちないようにするため
// （ramune が依存するフィールドだけを見る。ADR 0005 と同じ動機）。
//
// このファイルはテストのみが読む。`tools/ramune/hooks/src/` は node_modules が
// 無くても動く必要があるため zod を import できないが（ADR 0004）、テストは
// vitest 自体が node_modules を要求するのでこの制約の対象外である。
const denyOutputSchema = z.looseObject({
  hookSpecificOutput: z.looseObject({
    hookEventName: z.literal("PreToolUse"),
    permissionDecision: z.literal("deny"),
    permissionDecisionReason: z.string(),
  }),
});

/**
 * hook の標準出力が公式ドキュメントどおりの deny の形であることを検査し、
 * 拒否理由の文字列を返す。形が違えば ZodError がどのフィールドで外れたかを
 * 名指しで報告する。
 */
export function readDocumentedDenyReason(output: string): string {
  const parsed: unknown = JSON.parse(output);
  return denyOutputSchema.parse(parsed).hookSpecificOutput.permissionDecisionReason;
}
