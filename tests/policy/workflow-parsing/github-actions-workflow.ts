/**
 * GitHub Actions の workflow YAML から、policy-as-test が必要とする最小限の
 * 情報（jobs: 直下のジョブ一覧・各ジョブの needs・指定したジョブの本文・
 * env: の key/value・image: の参照先）だけを取り出す薄いパーサ群。
 * `strategy.matrix.task` の抽出は github-actions-matrix.ts に分離している
 * (このファイルの行数を codopsy の max-lines 内に収めるための分割)。
 *
 * 汎用 YAML パーサは新規依存として追加できる立場にない（tests/policy は
 * pnpm workspace パッケージではない）ため、workflow が実務上ほぼ必ず
 * 2 スペースインデントの素直な構造で書かれていることを前提に、正規表現と
 * 行ベースの走査で必要な情報だけを取り出す。汎用性は捨てている。
 */
import {
  collectBlockListItems,
  findBlockEnd,
  indentOf,
  parseInlineListValue,
  stripQuotes,
} from "../yaml-primitives/yaml-primitives.ts";

/** YAML テキストを行ごとに split した配列。 */
type Lines = readonly string[];

interface WorkflowJob {
  readonly id: string;
  readonly needs: readonly string[];
}

interface EnvEntry {
  readonly key: string;
  /** クォートを剥がす前の生の値。 */
  readonly rawValue: string;
  readonly line: number;
}

/** `needs:` 行からインラインの値(スカラーまたはフローリストの生テキスト)を取り出す。 */
function parseInlineNeedsValue(needsLine: string): string {
  const inlineMatch = /^\s*needs:\s*(?<value>.+)$/u.exec(needsLine);
  if (!inlineMatch) {
    return "";
  }
  return inlineMatch.groups?.value?.trim() ?? "";
}

/** ジョブ本文から needs: の値を取り出す(インラインスカラー・インラインフローリスト・ブロックリストの 3 形)。 */
function extractNeeds(jobBody: string): string[] {
  const lines = jobBody.split("\n");
  const needsLineIndex = lines.findIndex((line) => /^\s*needs:/u.test(line));
  if (needsLineIndex === -1) {
    return [];
  }

  const needsLine = lines[needsLineIndex] ?? "";
  const inlineNeeds = parseInlineListValue(parseInlineNeedsValue(needsLine));
  if (inlineNeeds !== undefined) {
    return inlineNeeds;
  }

  return collectBlockListItems(lines, needsLineIndex + 1, indentOf(needsLine));
}

interface RawJob {
  readonly id: string;
  readonly startLine: number;
}
/** `startIndex` から見て、最初の非空・非コメント行のインデントを返す。無ければ -1。 */
function findFirstEntryIndent(lines: Lines, startIndex: number): number {
  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }
    return indentOf(line);
  }
  return -1;
}

interface JobIdMatcher {
  readonly indent: number;
  readonly pattern: RegExp;
}

/** `<indent><id>:` の行(ジョブ ID 行は必ずこの形)であれば RawJob を、そうでなければ undefined を返す。 */
function tryMatchRawJob(line: string, index: number, matcher: JobIdMatcher): RawJob | undefined {
  if (line.trim() === "" || indentOf(line) !== matcher.indent) {
    return undefined;
  }
  const match = matcher.pattern.exec(line);
  if (!match) {
    return undefined;
  }
  return { id: stripQuotes(match[1] ?? ""), startLine: index };
}

/** `jobs:` 直下、`jobIndent` と同じ深さにあるジョブ ID の行だけを集める。 */
function collectRawJobs(lines: Lines, startIndex: number, jobIndent: number): RawJob[] {
  const matcher: JobIdMatcher = {
    indent: jobIndent,
    pattern: new RegExp(`^ {${jobIndent}}([A-Za-z0-9_.-]+|"[^"]+"|'[^']+'):\\s*(#.*)?$`, "u"),
  };
  const blockEnd = findBlockEnd(lines, startIndex, jobIndent);
  const rawJobs: RawJob[] = [];

  for (let lineIndex = startIndex; lineIndex < blockEnd; lineIndex += 1) {
    const rawJob = tryMatchRawJob(lines[lineIndex] ?? "", lineIndex, matcher);
    if (rawJob) {
      rawJobs.push(rawJob);
    }
  }

  return rawJobs;
}

/** 1 つのジョブの本文(次のジョブの開始行、または末尾まで)を切り出す。 */
function resolveJobBody(lines: Lines, current: RawJob, next: RawJob | undefined): string {
  let endLine = lines.length;
  if (next) {
    endLine = next.startLine;
  }
  return lines.slice(current.startLine + 1, endLine).join("\n");
}

/** ジョブ ID の開始行の並びから、各ジョブの本文を切り出して needs を解決する。 */
function resolveJobsFromRawJobs(lines: Lines, rawJobs: readonly RawJob[]): WorkflowJob[] {
  return rawJobs.map((current, jobIndex) => {
    const body = resolveJobBody(lines, current, rawJobs[jobIndex + 1]);
    return { id: current.id, needs: extractNeeds(body) };
  });
}

interface ParsedJobs {
  readonly lines: Lines;
  readonly rawJobs: readonly RawJob[];
}

interface JobsSection {
  readonly jobsLineIndex: number;
  readonly jobIndent: number;
}

/** `jobs:` 見出しの位置と、直下エントリのインデントを求める。`jobs:` が無い、または空なら undefined。 */
function findJobsSection(lines: Lines): JobsSection | undefined {
  const jobsLineIndex = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
  if (jobsLineIndex === -1) {
    return undefined;
  }
  const jobIndent = findFirstEntryIndent(lines, jobsLineIndex + 1);
  if (jobIndent === -1) {
    return undefined;
  }
  return { jobsLineIndex, jobIndent };
}

/** `jobs:` 直下のジョブ ID 一覧(本文を切り出す前の生の状態)を取り出す。`extractJobs` と `extractJobBody` の共通処理。 */
function collectJobsFromYaml(yamlText: string): ParsedJobs {
  const lines = yamlText.split("\n");
  const section = findJobsSection(lines);
  if (!section) {
    return { lines, rawJobs: [] };
  }
  return {
    lines,
    rawJobs: collectRawJobs(lines, section.jobsLineIndex + 1, section.jobIndent),
  };
}

/** `jobs:` 直下のジョブ一覧と、各ジョブの `needs:` を取り出す。 */
function extractJobs(yamlText: string): WorkflowJob[] {
  const { lines, rawJobs } = collectJobsFromYaml(yamlText);
  return resolveJobsFromRawJobs(lines, rawJobs);
}

/** `jobId` で指定したジョブの本文(ジョブ ID 行の次行から、次のジョブの開始行または末尾まで)を取り出す。ジョブが無ければ undefined。 */
function extractJobBody(yamlText: string, jobId: string): string | undefined {
  const { lines, rawJobs } = collectJobsFromYaml(yamlText);
  const jobIndex = rawJobs.findIndex((job) => job.id === jobId);
  if (jobIndex === -1) {
    return undefined;
  }
  const current = rawJobs[jobIndex];
  if (!current) {
    return undefined;
  }
  return resolveJobBody(lines, current, rawJobs[jobIndex + 1]);
}

const ENV_ENTRY_LINE = /^\s*(?<key>[A-Za-z0-9_.-]+|"[^"]+"|'[^']+'):\s*(?<value>.*)$/u;
/** `env:` 直下の 1 行から key/value を取り出す。マッチしなければ undefined。 */
function tryParseEnvEntry(line: string, lineNumber: number): EnvEntry | undefined {
  const entryMatch = ENV_ENTRY_LINE.exec(line);
  if (!entryMatch) {
    return undefined;
  }
  return {
    key: stripQuotes(entryMatch.groups?.key ?? ""),
    rawValue: (entryMatch.groups?.value ?? "").trim(),
    line: lineNumber,
  };
}

/** `indent` 以下のインデントに戻る最初の非空行の index を返す(見つからなければ末尾)。 */
function findEnvBlockEnd(lines: Lines, startIndex: number, envIndent: number): number {
  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim() === "") {
      continue;
    }
    if (indentOf(line) <= envIndent) {
      return lineIndex;
    }
  }
  return lines.length;
}

/** 1 つの env: マッピング直下(インデントが envIndent より深い行)から key/value を集める。 */
function collectEnvEntriesAt(lines: Lines, startIndex: number, envIndent: number): EnvEntry[] {
  const blockEnd = findEnvBlockEnd(lines, startIndex, envIndent);
  const entries: EnvEntry[] = [];

  for (let lineIndex = startIndex; lineIndex < blockEnd; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim() === "") {
      continue;
    }
    const entry = tryParseEnvEntry(line, lineIndex + 1);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/** ファイル全体から env: マッピングをすべて取り出す(secret 検査は場所を問わないためスコープの区別はしない)。 */
function extractEnvEntries(yamlText: string): EnvEntry[] {
  const lines = yamlText.split("\n");
  const entries: EnvEntry[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (!/^\s*env:\s*(?<trailingComment>#.*)?$/u.test(line)) {
      continue;
    }
    const envIndent = indentOf(line);
    entries.push(...collectEnvEntriesAt(lines, lineIndex + 1, envIndent));
  }

  return entries;
}

/** ファイル全体から `image:` の参照先をすべて取り出す(container / services 用)。 */
function extractImageRefs(yamlText: string): string[] {
  const refs: string[] = [];
  for (const line of yamlText.split("\n")) {
    const match = /^\s*image:\s*(?<value>.+)$/u.exec(line);
    if (!match) {
      continue;
    }
    refs.push(stripQuotes((match.groups?.value ?? "").split("#")[0] ?? ""));
  }
  return refs;
}

export { extractJobs, extractJobBody, extractEnvEntries, extractImageRefs };
export type { WorkflowJob, EnvEntry };
