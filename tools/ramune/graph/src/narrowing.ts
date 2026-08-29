// グラフノードの union から、状態ごとに共通の契約を持つ部分集合を取り出す型。
// 検査・操作の両方から参照されるため、どちらか一方のファイルに置くと
// 循環依存や二重管理の原因になる（原則7「拡張はファイルの追加で表現される」）。
import type { Candidate } from "./work.ts";
import type { RepositoryNode } from "./nodes.ts";

/** candidate を保持している repository_change ノード。 */
export type CandidateHoldingNode = Extract<RepositoryNode, { readonly candidate: Candidate }>;

/** 統合 journal を保持している repository_change ノード（integrating）。 */
export type IntegratingNode = Extract<RepositoryNode, { readonly integration: unknown }>;
