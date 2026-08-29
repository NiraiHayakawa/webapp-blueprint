/**
 * 原則10（依存 pin）/ §5「policy-as-test」の「依存 pin」検証。
 *
 * 検証内容は design §2「原則10の要件詳細」・§5 の表に明記された 2 点のみ:
 * ① manifest（package.json / pnpm-workspace.yaml の catalog）と lockfile
 *    （pnpm-lock.yaml）にレンジ指定（`^` `~` `*` `latest`）が残っていないこと
 * ② コンテナイメージが digest かタグで固定されていること（`uses:` の
 *    action 参照の pin 方針は、この table の行には明記が無いため対象外にする。
 *    Action 参照を SHA 固定にするかどうかは別途の判断が要る、と report に
 *    明記する）
 */

import type { PolicyViolation } from "../violation.ts";

const RANGE_CHARACTERS = /[\^~*]/u;
const LATEST_WORD = /(?<before>^|[^a-z])latest(?<after>[^a-z]|$)/iu;

/**
 * 内部モノレポ間参照（`workspace:` プロトコル）と、catalog 参照のマーカー
 * （`catalog:`）は「レンジ指定」の対象外にする。
 *
 * `catalog:` は pnpm-workspace.yaml の catalog エントリを見に行くだけの
 * 印であり、実体の pin はそちら側（`checkCatalogSpecifiers`）で見る。
 * `workspace:` はモノレポ内の兄弟パッケージを指す pnpm 独自のプロトコルで、
 * 外部で公開されたバージョンのレンジではない。ただし現時点で `packages/`
 * は空で `workspace:` 参照の実例が無いため、この除外が妥当かは未検証
 * （report に明記する）。
 */
function isExemptSpecifier(specifier: string): boolean {
  return specifier === "catalog:" || specifier.startsWith("workspace:");
}

function isRangeSpecifier(specifier: string): boolean {
  if (isExemptSpecifier(specifier)) {
    return false;
  }
  if (specifier === "*") {
    return true;
  }
  if (RANGE_CHARACTERS.test(specifier)) {
    return true;
  }
  if (LATEST_WORD.test(specifier)) {
    return true;
  }
  return false;
}

interface NamedSpecifier {
  readonly name: string;
  readonly specifier: string;
}

function checkSpecifiers(source: string, specifiers: readonly NamedSpecifier[]): PolicyViolation[] {
  return specifiers
    .filter((entry) => isRangeSpecifier(entry.specifier))
    .map((entry) => ({
      source,
      message: `"${entry.name}" の specifier "${entry.specifier}" がレンジ指定になっている（^ ~ * latest のいずれかを含む）`,
    }));
}

/**
 * コンテナイメージ参照から取り出した固定情報。digest とタグのどちらも持たない
 * （= 何も固定されていない）状態を表せる必要があるため、両方を任意にする。
 */
interface ImageRef {
  readonly tag?: string;
  readonly digest?: string;
}

function parseImageRef(image: string): ImageRef {
  const digestMatch = /@sha256:[0-9a-f]{64}$/u.exec(image);
  if (digestMatch) {
    return { digest: digestMatch[0] };
  }
  const lastSegment = image.split("/").pop() ?? image;
  const tagMatch = /:(?<tag>[^:]+)$/u.exec(lastSegment);
  const tag = tagMatch?.[1];
  if (tag !== undefined) {
    return { tag };
  }
  return {};
}

function isPinnedImageRef(image: string): boolean {
  const { tag, digest } = parseImageRef(image);
  if (digest !== undefined) {
    return true;
  }
  if (tag === undefined) {
    return false;
  }
  return tag.toLowerCase() !== "latest";
}

function checkImagePins(source: string, images: readonly string[]): PolicyViolation[] {
  return images
    .filter((image) => !isPinnedImageRef(image))
    .map((image) => ({
      source,
      message: `container image "${image}" が digest でもタグでも固定されていない（"latest" またはタグ省略）`,
    }));
}

export { isRangeSpecifier, checkSpecifiers, isPinnedImageRef, checkImagePins };
export type { NamedSpecifier };
