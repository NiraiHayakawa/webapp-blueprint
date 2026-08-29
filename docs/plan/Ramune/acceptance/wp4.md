# WP4 検証・受入仕様書: hooks（integrator role・権限表の置き換え・graph locator）

- 対象: `tools/ramune/hooks/`
- 設計正本: [20260824_parallel-execution.md](../20260824_parallel-execution.md) §8（ツール名一覧）・§9（hook と role の変更）

## 変更ファイル一覧

すべて `tools/ramune/hooks/` 配下。

| ファイル                    | 種別     | 内容                                                                                                                                                                    |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/role.ts`               | 変更     | `Role` に `"integrator"` を追加（`agent_type: "integrator"`）。トポロジのコメントを 3 役に更新                                                                          |
| `src/policy.ts`             | 変更     | 権限表を設計正本 §8 の表に置き換え。`ramune_next_node` の行を削除（互換エントリなし → `UnknownToolError`）。判定をルールテーブル化                                      |
| `src/mode.ts`               | 変更     | 判定条件を `session.active` から v2 の `session.state` へ読み替え。canonical リポジトリ解決を locator 経由に変更。v1 形は判定不能（拒否側）                             |
| `src/pre-tool-use.ts`       | 変更     | `runHook` の第 2 引数を「セッションの作業ディレクトリ」に改名し、locator 解決と fail-closed 拒否の契約をドキュメント化。ロジック構造は不変                              |
| `src/index.ts`              | 変更     | `GraphLocatorError` / `resolveCanonicalRepositoryRoot` を公開面へ追加                                                                                                   |
| `src/locator.ts`            | 新規     | canonical リポジトリルートの解決（§9 / §10 hard gate 2）。git 配置（`.git` ディレクトリ or linked worktree の `.git` ファイル）から解決し、不能なら `GraphLocatorError` |
| `test/support/fake-repo.ts` | 新規     | git リポジトリの形をした一時ディレクトリの fixture（`.ramune/graph.json` 書き込みヘルパ、v2 session JSON ビルダを集約）                                                 |
| `test/locator.test.ts`      | 新規     | locator の解決成功系 5 ケースと fail-closed 系 5 ケース                                                                                                                 |
| `test/mode.test.ts`         | 書き直し | `session.state` の active / inactive / 判定不能（v1 形含む）+ 解決不能時の `GraphLocatorError`                                                                          |
| `test/policy.test.ts`       | 書き直し | §8 のロール × ツール全組み合わせ（4 ロール × 15 ツール）、削除済み `ramune_next_node` の拒否、拒否理由文言                                                              |
| `test/pre-tool-use.test.ts` | 書き直し | stdin / stdout 契約。allow / deny ケースを新ツール一覧に更新、`ramune_next_node` が deny JSON になることを追加                                                          |
| `test/run-hook.test.ts`     | 書き直し | モード外 / 稼働中 / 判定不能 / 解決不能。linked worktree の cwd から canonical 側の稼働判定が効くことを契約として固定                                                   |
| `test/role.test.ts`         | 変更     | `agent_type: "integrator"` の判定ケースを追加                                                                                                                           |

## テスト仕様・検証結果

| 検証              | コマンド                                                     | 検証内容                                                        |
| ----------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| hooks 単体テスト  | `pnpm --filter @webapp-blueprint/ramune-hooks run test`      | 6 files / 全 190 テスト通過                                     |
| 型検査            | `pnpm --filter @webapp-blueprint/ramune-hooks run typecheck` | 型エラー 0                                                      |
| lint（hooks）     | `pnpm exec oxlint --type-aware tools/ramune/hooks`           | エラー 0                                                        |
| format（hooks）   | `pnpm exec oxfmt --check tools/ramune/hooks`                 | 違反 0                                                          |
| harness-bootstrap | `pnpm exec vitest run tests/policy/harness-bootstrap`        | hooks の import 契約（node_modules 非依存・ADR 0004）を機械検証 |

## 設計正本からの逸脱と判断

逸脱はない。以下は正本が定めなかった実装詳細の確定事項。

1. **canonical graph locator の解決方法**（§9）
   - 作業ディレクトリから親方向へ最初に見つかる `.git` がディレクトリならその親が canonical ルート。ファイル（linked worktree マーカ）なら `gitdir:` 指先の 2 段上 `<canonical>/.git` の親を canonical ルートとする。gitdir の相対パス記載にも対応。
   - 解決不能の判定基準: 親方向に `.git` が無い / `.git` ファイルが `gitdir:` 形でない / gitdir が worktree 配置（`.git/worktrees/<name>`）でない（submodule の `.git/modules/<name>` 形を含む）/ 指先が存在しない（stale）。いずれも非稼働に丸めず deny（fail-closed）。
   - 「解決できなければ拒否」と「グラフファイルが無ければ非稼働（判定を下さない）」の境界は、**canonical リポジトリの解決に成功したか**で分ける。解決成功後の `.ramune/graph.json` 不在は従来どおり非稼働扱いとし、fail-closed の方針と mode.ts の稼働判定枠組みを維持。

2. **`session.state` の読み取りを hooks 側（mode.ts 内）に保持**
   - 配置パス（`GRAPH_FILE_RELATIVE_PATH`）のみを persisted-graph.ts から共有し、state の 1 ビット読み取りは ADR 0005 の理由に従い hooks ローカルで最小限に保持する。依存ゼロの相対 import という ADR 0004 の制約は維持（harness-bootstrap が機械強制）。

3. **v1 の `session.active` は受理しない**
   - 旧フィールドを持つグラフは判定不能（`RamuneModeIndeterminateError`）→ deny。互換受理は作らない（絶対規約 3）。

4. **Edit / Write は Worker 専用のまま（Integrator には付与しない）**
   - §8 の表にビルトインツールの行はなく、integrator 定義（Read / Grep / Glob / Bash + 統合系 ramune ツール）と矛盾しないよう現行の権限を維持する。merge conflict の解消は Worker が担う解消ノード R として表現される（§6.3）。

5. **`.claude/settings.json` の matcher 契約**
   - matcher のツール呼び出しは hook 内で policy 判定され、未許可ツールは `UnknownToolError` → deny JSON になる（fail-open ではない）。
