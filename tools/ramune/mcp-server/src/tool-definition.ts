// 1 つの MCP ツールが満たす公開契約の型。
//
// `inputSchema` には ajv でのランタイム検証と、MCP の ListTools 応答に
// 返す JSON Schema の両方に「同じオブジェクト」をそのまま使う。これが
// 「契約 = JSON Schema」を実装する仕組みそのもの
// （contract/README.md、docs/principles/contract-is-ssot.md）。
// 検証用と告知用の2つの表現を別々に書くと、その2つがずれる（drift する）
// 余地が生まれるため、最初から1つのオブジェクトしか存在しない形にする。
//
// handle は async である。全てのツールが GraphStore.transaction() /
// read()（§4。async mutex 直列化）を経由するためであり、同期ハンドラは
// v2 の契約に存在しない。
import type { JsonValue } from "@webapp-blueprint/ramune-graph";
import type { GraphStore } from "./store.ts";

/**
 * ツールが著述する JSON Schema の型。意図的に緩い（Record）形にしている。
 *
 * SDK v2 の `Tool["inputSchema"]` は JSON Schema の厳格な構造的 union であり、
 * oneOf / const / enum を含む手書きリテラルをそのまま受けない。契約の実行時の
 * 正は ajv（server.ts が同じオブジェクトで compile する）であり、著述側は素の
 * オブジェクトでよい。SDK の ListTools 応答型への適合は server.ts の
 * toSdkInputSchema() の 1 箇所だけで行う（「検証用と告知用の2つの表現を書かない」
 * 原則は、この1つのオブジェクトを両方に使うことで維持される）。
 *
 * 値の型は `unknown` ではなく JsonValue にする: JSON Schema のリテラルは
 * 常に JSON 値（文字列・数値・真偽値・null・配列・オブジェクト）でしか
 * 構成されないため、その契約を型で表現できる（anti-slop/no-unsafe-dictionary-type）。
 */
export type InputSchema = Readonly<Record<string, JsonValue>>;

export interface ToolDefinition<Input, Output> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: InputSchema;
  readonly handle: (store: GraphStore, input: Input) => Promise<Output>;
}
