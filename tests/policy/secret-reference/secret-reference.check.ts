/**
 * 原則9(secrets-by-reference)/ §5「policy-as-test」の「secret 参照」検証。
 *
 * ① `.env.example` に `op://` 参照以外の値が無いこと
 * ② workflow の `env:` に平文が無いこと
 *
 * ②の「平文」の定義は、実際の workflow(.github/workflows/pr-review-claude.yml
 * 等)を確認した上で絞り込んだ。workflow の `env:` には
 * `<!-- pr-review:claude:summary -->` のような、値そのものが secret ではない
 * リテラル文字列(コメントマーカー・モード名)が正当に存在する。そのため
 * 「式(`${{ ... }}`)以外のリテラルはすべて平文」という判定は誤検知が
 * 大きすぎる(実際にこの誤検知を実装中に確認した)。
 *
 * 代わりに、**キー名が secret を示唆する**(`TOKEN` `SECRET` `PASSWORD`
 * `CREDENTIAL` `API_KEY` 等を含む)env エントリに限って、値が式または
 * `op://` 参照になっていることを要求する。この閾値(キー名のパターン)は
 * spec に明記が無いため本ファイルで定義し、report に明記する。
 *
 * secretlint(エントロピーベースの実測的な secret 検出)とは役割を分ける。
 * secretlint は「値が実際に secret らしいか」を判定するのに対し、ここでは
 * 「secret 用途を名乗る変数が、参照ではなく直接値を持っていないか」という
 * **構造的な**判定にする。
 */

import type { EnvEntry } from "../workflow-parsing/github-actions-workflow.ts";
import type { PolicyViolation } from "../violation.ts";

const OP_REFERENCE = /^op:\/\/[^/]+\/[^/]+\/[^/]+$/u;
const GITHUB_ACTIONS_EXPRESSION = /^\$\{\{.*\}\}$/u;
const SECRET_LIKE_KEY_NAME =
  /(?<secretWord>TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)/iu;

interface EnvExampleEntry {
  readonly key: string;
  readonly value: string;
  readonly line: number;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.at(-1) === '"') {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** `.env.example` の 1 行を `KEY=value` としてパースする。コメント・空行・不整合な行は undefined を返す。 */
function parseEnvExampleLine(line: string, lineNumber: number): EnvExampleEntry | undefined {
  const trimmedLine = line.trim();
  if (trimmedLine === "" || trimmedLine.startsWith("#")) {
    return undefined;
  }
  const match = /^(?<key>[A-Za-z0-9_]+)=(?<value>.*)$/u.exec(trimmedLine);
  if (!match) {
    return undefined;
  }
  return { key: match[1] ?? "", value: stripQuotes(match[2] ?? ""), line: lineNumber };
}

function parseEnvExample(text: string): EnvExampleEntry[] {
  const entries: EnvExampleEntry[] = [];
  const lines = text.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const entry = parseEnvExampleLine(lines[lineIndex] ?? "", lineIndex + 1);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

/** `.env.example` の全エントリは(secret を名乗るかどうかを問わず)op:// 参照のみが許される。 */
function checkEnvExampleValues(
  source: string,
  entries: readonly EnvExampleEntry[],
): PolicyViolation[] {
  return entries
    .filter((entry) => !OP_REFERENCE.test(entry.value))
    .map((entry) => ({
      source,
      message: `${entry.key}(${entry.line} 行目)の値が op://vault/item/field 参照になっていない: "${entry.value}"`,
    }));
}

function isSecretLikeKeyWithLiteralValue(entry: EnvEntry): boolean {
  if (!SECRET_LIKE_KEY_NAME.test(entry.key)) {
    return false;
  }
  if (GITHUB_ACTIONS_EXPRESSION.test(entry.rawValue)) {
    return false;
  }
  if (OP_REFERENCE.test(entry.rawValue)) {
    return false;
  }
  return true;
}

/**
 * workflow の env: のうち、キー名が secret を示唆するもの
 * (`TOKEN` `SECRET` `API_KEY` 等)だけを対象に、値が式(`${{ ... }}`)や
 * `op://` 参照ではない直接値になっていないかを検証する。
 */
function checkWorkflowEnvValues(source: string, entries: readonly EnvEntry[]): PolicyViolation[] {
  return entries
    .filter((entry) => isSecretLikeKeyWithLiteralValue(entry))
    .map((entry) => ({
      source,
      message: `env.${entry.key}(${entry.line} 行目)は secret を示唆するキー名なのに、式でも op:// 参照でもない値を直接持っている: "${entry.rawValue}"`,
    }));
}

export { parseEnvExample, checkEnvExampleValues, checkWorkflowEnvValues };
export type { EnvExampleEntry };
