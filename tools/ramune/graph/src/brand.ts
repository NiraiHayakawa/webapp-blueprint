// branded type の定義と、スカラー値の実行時契約（zod スキーマ）。
//
// 設計正本 §2「型は branded type を全面採用する」の受け皿。`Brand<T, Name>` は
// zod v4 の `.brand<>()` が作る出力型（`T & $brand<Name>`。$brand は zod 本体が
// export する unique symbol）と同じ形をしたヘルパであり、ここで宣言した型別名と
// zod スキーマの出力型が構造的に一致する。一致が崩れた瞬間 `parseGraph`
// （graph-schema.ts）の戻り値型検査が落ちる。
//
// ID の取り違え（CommitId ↔ WorkspaceId 等）をコンパイル時に落とすために、
// 生の string / number をそのまま公開契約に使わない。ブランドを付けた値を作る
// 経路は次の2つに限定する:
//   1. このファイルの各スキーマの parse（境界で来た外部 JSON の検証）
//   2. allocator（transaction.ts）による発番
import { z, type $brand } from "zod/v4";

export type Brand<T, Name extends string> = T & $brand<Name>;

export type NonEmptyString = Brand<string, "NonEmptyString">;
export type IsoDateTime = Brand<string, "IsoDateTime">;
export type Digest = Brand<string, "Digest">;
export type RepoPath = Brand<string, "RepoPath">;
export type CommitId = Brand<string, "CommitId">;
export type RunId = Brand<string, "RunId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type PlannedNodeId = Brand<string, "PlannedNodeId">;
export type GeneratedNodeId = Brand<string, "GeneratedNodeId">;
export type TaskNodeId = PlannedNodeId | GeneratedNodeId;

export type Revision = Brand<number, "Revision">;
export type Epoch = Brand<number, "Epoch">;
export type AllocationId = Brand<number, "AllocationId">;
export type AssignmentId = Brand<number, "AssignmentId">;
export type ConflictId = Brand<number, "ConflictId">;
export type BlockageId = Brand<number, "BlockageId">;
export type NonZeroExitCode = Brand<number, "NonZeroExitCode">;

/**
 * 任意の JSON 値。graph.json に直列化される以上「JSON 値である」こと自体が契約
 * （v1 の graph.ts と同じ理由）。`unknown` は消費側に typeof 分岐を強いるため使わない。
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const RESERVED_START_NODE_ID = "start";
export const RESERVED_END_NODE_ID = "end";

export const nonEmptyStringSchema = z.string().min(1).brand<"NonEmptyString">();
export const isoDateTimeSchema = z.iso.datetime().brand<"IsoDateTime">();
export const digestSchema = z.string().min(1).brand<"Digest">();
export const repoPathSchema = z.string().min(1).brand<"RepoPath">();
export const commitIdSchema = z.string().min(1).brand<"CommitId">();
export const runIdSchema = z.string().min(1).brand<"RunId">();
export const workspaceIdSchema = z.string().min(1).brand<"WorkspaceId">();

/** 非負の safe integer（§2.8）。Revision / Epoch / 各種発番 ID の共通形。 */
const nonNegativeIntSchema = z.int().nonnegative();

export const revisionSchema = nonNegativeIntSchema.brand<"Revision">();
export const epochSchema = nonNegativeIntSchema.brand<"Epoch">();
export const allocationIdSchema = nonNegativeIntSchema.brand<"AllocationId">();
export const assignmentIdSchema = nonNegativeIntSchema.brand<"AssignmentId">();
export const conflictIdSchema = nonNegativeIntSchema.brand<"ConflictId">();
export const blockageIdSchema = nonNegativeIntSchema.brand<"BlockageId">();
/** 0 は成功を意味するため exit code としては許さない（SuccessfulCheck の exitCode は literal 0）。 */
export const nonZeroExitCodeSchema = z.int().gt(0).brand<"NonZeroExitCode">();

export const jsonValueSchema = z.json();

/** 機械生成ノード ID の名前空間。allocator が `gen-<発番>` の形で mint する。 */
const GENERATED_NODE_ID_PATTERN = /^gen-\d+$/u;

export const generatedNodeIdSchema = z
  .string()
  .regex(GENERATED_NODE_ID_PATTERN)
  .brand<"GeneratedNodeId">();

/**
 * Planner が選べるノード ID。空文字・予約 ID（start / end）・機械生成名前空間を
 * 拒否する（設計正本 §2.5「start / end と機械生成 namespace のノード ID を
 * Planner は使用できない」）。
 */
export const plannedNodeIdSchema = z
  .string()
  .min(1)
  .refine((value) => value !== RESERVED_START_NODE_ID && value !== RESERVED_END_NODE_ID, {
    message: "start / end は boundary ノードの予約 ID であり Planner は使用できない",
  })
  .refine((value) => !GENERATED_NODE_ID_PATTERN.test(value), {
    message: "gen- で始まる ID は機械生成ノードの名前空間であり Planner は使用できない",
  })
  .brand<"PlannedNodeId">();

export const taskIdSchema = z.union([plannedNodeIdSchema, generatedNodeIdSchema]);
/**
 * task ノードの deps。start を直接依存できる（start 直下の task がグラフの入口）。
 * end は依存先になり得ない（end はシンク。§2.7）。
 */
export const taskDepsSchema = z.array(z.union([taskIdSchema, z.literal("start")]));
/**
 * プログラム内部から非空文字列を NonEmptyString として mint する唯一の経路。
 * 境界の外では schema.parse、内側ではこの関数を使う（空文字は fail-fast で落とす）。
 */
export function toNonEmptyString(value: string): NonEmptyString {
  const result = nonEmptyStringSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError("空文字列は NonEmptyString になれない");
  }
  return result.data;
}
