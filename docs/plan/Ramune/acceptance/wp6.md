# WP6 検証・受入仕様書: worktree と統合の Git 機構

- 対象: `tools/ramune/git/`（`@webapp-blueprint/ramune-git`）
- 設計正本: [20260824_parallel-execution.md](../20260824_parallel-execution.md) §6（特に §6.2 §6.4）・§7

## 変更ファイル一覧

### パッケージ構成 `tools/ramune/git/`

| ファイル                                                                                                       | 内容                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                                                                 | 依存は `@webapp-blueprint/ramune-graph: workspace:*` のみ（branded 型・スキーマ・sameFence）。devDeps は typescript / vitest / @types/node                                  |
| `tsconfig.json` / `vitest.config.ts`                                                                           | パッケージ設定                                                                                                                                                              |
| `src/index.ts`                                                                                                 | 公開面（re-export のみ）                                                                                                                                                    |
| `src/git-command.ts`                                                                                           | 最下層のプロセス実行（引数配列・shell 不使用・出力 16 MiB 上限）。`runProcess` / `runGit` / `runGitOutcome` / `commitExists`                                                |
| `src/process-error.ts` / `src/git-command-error.ts`                                                            | プロセス起動失敗 / git 失敗の型付きエラー                                                                                                                                   |
| `src/fs-support.ts`                                                                                            | `pathExists`（async）                                                                                                                                                       |
| `src/worktree.ts`                                                                                              | **隔離 worktree の割当と回収**（§6.1）。`allocateWorkspace` / `reclaimWorkspace` / `workspacePath` / `workspaceBranchName`                                                  |
| `src/merge.ts` + error 3 件                                                                                    | **統合用 worktree での merge**（§6.2 step 2）。`prepareIntegrationMerge`。conflict は `MergeConflictError{conflictedFiles}` となり worktree は merge_in_progress のまま残る |
| `src/cleanup.ts`                                                                                               | **失敗経路の cleanup**（§6.2）。merge 中断 → reset --hard → clean -fd → clean 検査                                                                                          |
| `src/verify.ts` + error 2 件                                                                                   | **1 コマンド検証**（§6.2 step 3）。`runVerification`（測定）と `miseRunCheckEvidence`（SuccessfulCheck / FailedCheck 証跡化）                                               |
| `src/publish.ts`                                                                                               | **canonical publish の単一 authority 経路**（§6.4）。`publishCandidate`。前提違反は `PublishPreconditionError.violation`（discriminated union）                             |
| `src/observe.ts` + `canonical-not-clean-error.ts`                                                              | **GitObservation 採取**（§2.4 / §7）。`observeGit` / `captureCanonicalAfterCleanup`                                                                                         |
| `test/support/fake-git-repo.ts`                                                                                | 実 git リポジトリ fixture（init / commit / stub バイナリ設置。`.ramune/` を info/exclude する本番前提の再現を含む）                                                         |
| `test/support/journal-fixture.ts`                                                                              | journal / fence / assignment を graph の zod スキーマ経由で組み立てるヘルパ                                                                                                 |
| `test/worktree.test.ts` `merge.test.ts` `cleanup.test.ts` `verify.test.ts` `publish.test.ts` `observe.test.ts` | 公開契約テスト                                                                                                                                                              |

## 公開契約（API 一覧）

| 関数                                                                  | 入力 → 出力                                                                                                                                                                                | 対応                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `allocateWorkspace({repositoryRoot, workspaceId, baseCommit})`        | `{path, branch}`。`.ramune/workspaces/<id>` に `git worktree add -b ramune/workspace/<id> <baseCommit>`                                                                                    | §6.1 claim 時の割当               |
| `reclaimWorkspace({repositoryRoot, workspaceId})`                     | void。worktree + ブランチを削除。未割当は `WorktreePreconditionError{not_allocated}`                                                                                                       | done / abort 後の回収             |
| `prepareIntegrationMerge({integrationWorktreePath, candidateCommit})` | `{integratedCommit}`。--no-ff。dirty な worktree・未知 candidate は型付きエラー                                                                                                            | §6.2 step 2                       |
| `runVerification({cwd, checkedCommit, command?})`                     | `VerificationMeasurement{executedCommand, exitCode, outputDigest, finishedAt}`。既定コマンド `["mise","run","check"]`                                                                      | §6.2 step 3                       |
| `miseRunCheckEvidence(measurement)`                                   | `SuccessfulCheck \| FailedCheck`。既定コマンド以外の測定値は `VerificationEvidenceError`                                                                                                   | 証跡生成                          |
| `publishCandidate({repositoryRoot, journal, fence})`                  | `{publishedCommit}`。stage / fence（`sameFence`）/ canonical clean / HEAD=`canonicalHeadBefore` / is-ancestor を検査し `--ff-only` + 事後確認。崩れは `PublishPreconditionError.violation` | §6.4 単一経路                     |
| `cleanupFailedIntegration({integrationWorktreePath})`                 | void。MERGE_HEAD 解消・index / 作業ツリー復元・clean 検査まで                                                                                                                              | §6.2 cleanup 義務                 |
| `captureCanonicalAfterCleanup({repositoryRoot})`                      | `{head, worktree:"clean"}`。clean 以外は `CanonicalNotCleanError`                                                                                                                          | §6.3 `canonicalAfterCleanup` 証跡 |
| `observeGit({repositoryRoot, integrationWorktreePath})`               | `GitObservation`（clean / dirty / merge_in_progress / missing × 2 面 + HEAD）                                                                                                              | §7 abandon 照合の入力             |

## テスト仕様・検証結果

| 検証             | コマンド                                                                   | 結果                              |
| ---------------- | -------------------------------------------------------------------------- | --------------------------------- |
| パッケージテスト | `pnpm --filter @webapp-blueprint/ramune-git run test`                      | **34 passed**（6 files / 失敗 0） |
| 型検査           | `pnpm --filter @webapp-blueprint/ramune-git run typecheck`                 | エラー 0                          |
| lint             | `pnpm exec oxlint --type-aware tools/ramune/git/src tools/ramune/git/test` | エラー 0                          |
| format           | `pnpm exec oxfmt --check tools/ramune/git`                                 | 違反 0                            |

検証対象の契約:

- worktree 割当 / 干渉非依存 / 重複割当拒否 / 回収と回収漏れ拒否
- fast-forwardable merge と conflict 再現（同一ファイル両側変更）+ 競合ファイル報告
- check 失敗（exit 3）と成功時のダイジェスト一致、SuccessfulCheck / FailedCheck 証跡
- publish の 3 条件 + fast-forward 検査（HEAD 不一致・stale fence・claimed 段階・無関係履歴のそれぞれで拒否され canonical が動かないこと）
- cleanup 後の clean 判定、`canonicalAfterCleanup`、GitObservation の 4 値判定

## 設計正本からの逸脱と判断

1. **配置規約の確定**: worktree は `<repositoryRoot>/.ramune/workspaces/<workspaceId>`、専用ブランチは `ramune/workspace/<workspaceId>`。`.ramune/` はリポジトリ .gitignore 対象のため status を汚さない。
2. **merge は `--no-ff` 固定**: fast-forward 可能な位置でも統合コミットを作る。journal の `merge_prepared` / `publish_prepared` が「どの統合結果を検証したか」を常に単一 SHA で指せるようにするため。
3. **publish の前提条件を §6.4 の 3 条件 + α に強化**: 正本の 3 条件（publish_prepared / fence 一致 / expected HEAD）に加え、canonical が clean であること・integratedCommit が `canonicalHeadBefore` の子孫であること（is-ancestor）・実行後の事後確認（post_condition_violation）を機械検査に含める。
4. **fence 一致検査の分担**: 「fence が現在の assignment と一致する」ことの真の保証はグラフ transaction 内で現在値を取り出す呼び出し側にある。git 層は `sameFence(journal.assignment, 渡された fence)` を検査し、journal ↔ 引数の整合を機械的に担保する（二重防御）。
5. **検証コマンド注入と証跡の分離**: graph の `SuccessfulCheck.command` は literal `"mise run check"` のため、任意コマンドの測定値をそのまま証跡型にすると command が嘘をつく。そこで `runVerification`（正直な測定。executedCommand を記録）と `miseRunCheckEvidence`（既定コマンドの実行結果にしか証跡を作らせない）に分割した。
6. **outputDigest の定義**: stdout バイト列の直後に stderr バイト列を連結した内容の SHA-256（16 進小文字）。出力合計 16 MiB 超過・シグナル死亡は証跡化せず型付きエラー（部分的な出力のダイジェストを作らない。fail-closed）。
7. **cleanup は冪等、ただし worktree 不存在は拒否**: 既に clean なら成功（状態確認を兼ねる）。存在しない worktree は「clean になったことを証明できない」ため `CleanupIncompleteError`。
8. **観測不能は missing に丸めない**: canonical HEAD が解決できない場合のみ `GitObservationError`。worktree の 4 値判定は `.git` エントリ有無 → gitdir 解決 → MERGE_HEAD / porcelain の順で判定する。

## API 仕様と Integrator 手順

### claim 時（Worker 用 worktree プール）

```ts
// claim の直前に canonical HEAD を起点に必要数を用意し、
// graph の ClaimReadyOperation.workspaces（WorkspaceAllocation[]）へ渡す
const baseCommit = parseCommitId(revParseHead(repositoryRoot)); // claim 時点の canonical HEAD
const ws = await allocateWorkspace({ repositoryRoot, workspaceId, baseCommit });
pool.push({ workspaceId, baseCommit }); // 余らせると ClaimReadyPreconditionError(workspace_surplus)
```

- `workspaceId` / `baseCommit` は graph 側で発番・parse 済みの branded 値をそのまま渡す（再 parse 不要）。

### Integrator 工程（§6.2 の順序どおり）

1. `await allocateWorkspace({ workspaceId: assignment.workspaceId, baseCommit: canonicalHeadBefore })`
2. `prepareIntegrationMerge(...)` → 成功: `advanceIntegration`(merge_prepared) へ。conflict: 手順 5 へ
3. `runVerification({ cwd: integrationWorktreePath, checkedCommit })`（**command 省略 = 本番の mise run check**）
4. `miseRunCheckEvidence(measurement)` → `SuccessfulCheck` なら `advanceIntegration`(publish_prepared)／`FailedCheck` なら outcome `verification_failed`
5. conflict 経路: `cleanupFailedIntegration` → `captureCanonicalAfterCleanup`（`canonicalAfterCleanup` 証跡）→ `recordIntegrationOutcome`(conflict)。**cleanup は記録の前に必須**
6. `publish_prepared` をグラフへ**永続化してから** `publishCandidate({ journal, fence })`（§6.4 の CAS 順序。publish が先だと crash 後の照合ができない）
7. publish 成功 → outcome success。`PublishPreconditionError` → publish は未実施なので `integration_state_uncertain` として記録（§7）
8. done / abort 後に `reclaimWorkspace`

### その他

- **全関数は async**。
- `fence` はグラフ transaction 内で取り出した**現在の assignment** の fence を渡す（stale 完了報告はここで `fence_mismatch` に落ちる）。
- `observeGit` の戻り値はそのまま `GitObservation` として abandon 照合（§7）に渡せる。integration workspace を回収済みの場合は `missing` が返る。
