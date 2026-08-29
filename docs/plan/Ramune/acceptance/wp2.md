# WP2 検証・受入仕様書: GraphStore transaction

- 対象: `tools/ramune/mcp-server/src/store.ts`、store 関連エラークラス、およびそのテスト
- 設計正本: [20260824_parallel-execution.md](../20260824_parallel-execution.md) §4

## 実装内容

設計正本 [20260824_parallel-execution.md](../20260824_parallel-execution.md) §4、指示書「WP2: GraphStore transaction」節のとおり。

### 新 API（v1 の `load()` / `save()` 分離公開を廃止）

```ts
class GraphStore {
  constructor(options: { repositoryRoot: string });
  read(): Promise<GraphV2>; // 読み取り専用（ramune_read_graph 用）
  initialize(goal: string): Promise<GraphV2>; // 無ければ作る（ramune_start 用。goal 必須入力）
  transaction(options, mutate): Promise<GraphV2>; // 全ての変更の唯一の入口
  // options: { expectedRevision?: Revision }（判断系は提示、完了系は省略して fence 検査に任せる）
  // mutate: (graph: GraphV2) => GraphV2 | Promise<GraphV2>
  archiveUnsupportedVersion(): Promise<ArchiveUnsupportedVersionResult>;
}
```

- **async mutex**: `#queue` Promise 連結によるプロセス内直列化。「同期ハンドラだから事実上直列」という v1 の暗黙性に依存しない。クロスプロセスのファイルロックは意図的に存在しない（二重起動の排除は §5 port bind の責務）
- **atomic replace**: 同一ディレクトリの一時ファイル（`.graph.json.tmp-<uuid>`）へ書き込み → `fsync` → `rename` → 親ディレクトリ `fsync`。rename 失敗時は一時ファイルを掃除する。永続化するバイト列は rename 前に `parseGraph` で検証し、store が契約外のバイト列をディスクへ出さないことを永続化の境界で保証
- **expected_revision 検査**: transaction 入口で一致検査。不一致は `RevisionConflictError`（expected / actual を保持）。**自動リトライしない**
- **version ゲート**: raw JSON の version フィールドをスキーマ検査より先に覗き見し、`!== 2` なら `UnsupportedGraphVersionError` を投げる（mutate は実行されない）。このエラーは store の公開契約として新設
- **v1 raw 退避**: `archiveUnsupportedVersion()` は中身を解釈せず raw バイトを `.ramune/graph.v<version>.backup.json` へ別名保存（既存なら上書きせず失敗）し、元パスから取り除く。戻り値は判別可能 union（`archived` / `already_version_2`）で、呼び出し側が要否を観測できる
- **fail-fast 維持**: ファイル無し＋未初期化 → `GraphNotInitializedError`。形の違反 → `GraphFileCorruptedError`。JSON 壊れ → `SyntaxError` 伝播。goal の silent 補完は存在しない

## 変更ファイル一覧

### 変更

- `tools/ramune/mcp-server/src/store.ts` — 新 API 仕様への改訂
- `tools/ramune/mcp-server/test/store.test.ts` — 新契約テスト（22 テスト）

### 新規

- `tools/ramune/mcp-server/src/unsupported-graph-version-error.ts`
- `tools/ramune/mcp-server/src/revision-conflict-error.ts`
- `tools/ramune/mcp-server/src/graph-archive-target-exists-error.ts`

## テスト仕様・検証結果

検証コマンド:

```bash
pnpm --filter @webapp-blueprint/ramune-mcp-server exec vitest run test/store.test.ts
```

検証項目:

- initialize / read の往復、整形フォーマット + 一時ファイル不残存
- **並行 2 transaction の直列化**（lost update 回帰: 後続が先行の結果の上に適用されることを観測）
- expected_revision 一致 / 不一致（不一致 → RevisionConflictError・ファイル不変・自動リトライなし）
- mutate 例外時の非永続化と mutex 解放（後続 transaction が進む）
- mutate が契約外グラフを返した場合は永続化しない
- version ゲート: v1 → UnsupportedGraphVersionError（Corrupted ではない）、transaction は mutate を実行せず拒否、version 無し → Corrupted、JSON 壊れ → SyntaxError
- archive: raw バイト保全・元パス除去・退避後の再初期化・退避先重複で失敗・v2 は already_version_2・ファイル無しは NotInitialized
- running ノード（fence / journal 保持）を含む v2 グラフの往復

## 設計正本からの逸脱・解釈（理由付き）

1. **`initialize(goal)` という名前で作成経路を提供**（v1 の `loadOrCreate` に相当）。§4 は「全書き込みを transaction(fn) に集約」とのみ言い、ファイル新規作成の扱いを規定しないため。内部では mutex + persist を共有しており、load/save の分離公開にはあたらない。goal は必須引数（silent 補完なし）。
2. **永続化前の `parseGraph` 再検査**を追加した。§4 の手順に明記はないが、「store が壊れた状態をディスクへ出さない」ことの保証であり、コストは無視できる（グラフは小さい）。ドメイン操作の代替ではなく永続化の境界での防御。
3. **`read()` を mutex 外で提供**。atomic rename のため読み手は完全な内容しか見ない（torn read 不可能）という §4 の構造を利用する。直列化は書き込み競合の排除が目的であり、読み取りまで直列化する必要はない。
4. **`archiveUnsupportedVersion` の戻り値を判別可能 union にした**（`already_version_2` をエラーにしない）。冪等に近い明示操作であり、呼び出し側が分岐できる契約の方が扱いやすいため。退避先重複だけはデータ損失の恐れがあるため例外（`GraphArchiveTargetExistsError`）で止める。
5. **`initialGoal` オプション（コンストラクタ)を廃止**。作成は `initialize(goal)` へ一本化した。起動時に goal を持つユースケースは `initialize` で満たせる。

## atomic replace エラー処理仕様

- open からディレクトリ fsync までを単一 try/catch で包み、catch で一時ファイルを unlink（ENOENT は無視）してから rethrow する。
- 失敗注入テスト（`writeFile` / `sync` の失敗時）において、一時ファイル不残存（readdir が `graph.json` のみ）・元グラフ無傷・掃除後の継続利用可能性を検証。

## transaction API 仕様と利用手順

```ts
// 判断系ツール（例: ramune_apply_ops / ramune_claim_ready 相当）:
const next = await store.transaction(
  { expectedRevision }, // クライアント提示の revision
  (graph) => applyOperations(graph, ops), // ドメイン層の差分操作を組み立てる
);
// RevisionConflictError を catch したら自動リトライしない。
// ramune_read_graph で読み直させて判断からやり直させる（§4）

// 完了系ツール（fence で認証する操作）:
const next = await store.transaction({}, (graph) =>
  recordResult(graph, { type: "record_result", nodeId, fence, report }),
);

// ramune_start:
const graph = await store.initialize(goal);

// ramune_read_graph:
const graph = await store.read();

// v1 ファイルを検出した場合（UnsupportedGraphVersionError を catch）:
await store.archiveUnsupportedVersion(); // raw 退避後に initialize できる
```

- エラークラスはすべて `store.ts` から re-export されている。
- `initialGoal` は廃止され、初期化は `initialize(goal)` で行う。
- 各ツールハンドラは async 化し、store の transaction または read を経由する。
