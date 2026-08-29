import type { FailureReason } from "./failure-reason.js";

/**
 * 書き出されたログ行 1 本を読み戻すときの契約（event.ts の serializeEvent が
 * 書く payload の、読み手側から見た像）。
 *
 * 以前はフィールドごとに `typeof` で実行時検証する汎用アクセサ
 * （readStringField / readNumberField / readStringArrayField）を置いていた。
 * あれは値の表現を検査するだけで契約を確立しないアドホックな絞り込みであり、
 * 読み手はどのキーがどの型で来るのかを結局知らないままだった
 * （anti-slop no-runtime-typeof が禁じる形）。境界（JSON.parse）で 1 度だけ
 * この契約へ写し、以後は型付きのフィールドとして読む形に変える。
 */
/**
 * 失敗イベントを失敗たらしめるフィールドの組。ログ行として読み戻した側
 * （FailureLogLine）と、テーブル駆動テストが入力として与える側
 * （event.test.ts の it.each）の両方がこれを指す。同じ形を 2 箇所に書くと
 * similarity 検査が拾う（2026-08-18 に実際に落ちた）だけでなく、片方だけ
 * 増やしたときに気づけない。成功イベントでは両方とも欠けるため、LogLine は
 * この Partial を継承する。
 */
interface FailureFields {
  readonly code: string;
  readonly reasons: readonly FailureReason[];
}

interface LogLine extends Partial<FailureFields> {
  readonly message: string;
  readonly operation: string;
  readonly outcome: string;
  readonly level: string;
  readonly durationMs: number;
  readonly trace_id: string;
  readonly span_id: string;
}

/** code / reasons が揃っていることを確かめ済みの、失敗イベントのログ行。 */
type FailureLogLine = LogLine & FailureFields;

/**
 * ログ行 1 本を JSON から読み戻す。JSON.parse は構造的に `any` を返すため、
 * 契約へ写す地点はどうしても 1 箇所のアサーションになる。この 1 ファイルに
 * 閉じ、他のテストファイルへ広げない（原則4「抑制には理由を書く」）。
 */
function parseLogLine(line: string): LogLine {
  // SAFETY: line は serializeEvent が LogLine と同じ形の payload を
  // JSON.stringify した文字列である、というのがテストの前提そのもの。形が
  // 崩れれば「message を同じ payload の他フィールドから再構成できる」検証
  // （event.test.ts）が失敗するので、ここで検査を重ねても新たに検出できる
  // 事象は無い（検査を足すと、失敗が message の乖離ではなく fixture の
  // TypeError として出るぶん、むしろ原因が読みにくくなる）。
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 上記 SAFETY のとおり、契約へ写す地点をこの 1 箇所に閉じる
  return JSON.parse(line) as LogLine;
}

/**
 * 失敗イベント固有のフィールドが揃っていることを確かめる。値の表現
 * （typeof）ではなく、契約上そのフィールドが在るかどうかで分岐する。
 */
function asFailureLogLine(line: Readonly<LogLine>): FailureLogLine {
  const { code, reasons } = line;
  if (code === undefined || reasons === undefined) {
    throw new TypeError("失敗イベントのログ行に code / reasons が無い");
  }
  return { ...line, code, reasons };
}

export { asFailureLogLine, parseLogLine };
export type { FailureFields };
