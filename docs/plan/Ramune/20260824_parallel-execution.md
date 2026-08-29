# ramune 並列実行の設計

- 日付: 2026-08-24（同日、敵対的レビューを受けて全面改訂）
- 状態: 実装済み（全ゲート green。受入証跡は acceptance/ 配下）
- 決定ログ: [ADR 0010](../../adr/0010-parallel-execution-fenced-assignment.md) / [ADR 0011](../../adr/0011-isolated-worktree-serial-integration.md) / [ADR 0012](../../adr/0012-machine-inserted-conflict-node.md) / [ADR 0013](../../adr/0013-mcp-v2-shared-http-server.md)

ramune の実行モデルを「Orchestrator が Planner と Worker を交互に逐次起動する」形から、複数 Worker の並列実行へ拡張する。
本文書が設計の正本であり、ADR は決定と却下案の記録を持つ。
決定の理由をここに書き直さない。

## 1. 目的と範囲

対象は次の 4 層である。

- **スケジューラ**：同じノードを 2 つの Worker が掴まない保証（排他）をグラフに外在化する
- **ストア**：`.ramune/graph.json` への並行書き込みを契約として直列化する
- **実行モデル**：並列に走る Worker のファイル編集競合を、隔離 worktree と直列の統合工程で構造的に排除する
- **transport**：MCP サーバを単一共有 HTTP サーバにし、「writer が 1 本」を仮定ではなく構造にする（§5）

駆動主体（誰が ready ノードを検知して Worker を起動するか）は本設計の範囲外とする。
本設計は駆動に必要な契約（claim、fence、回復操作）をすべて MCP ツールとグラフに外在化し、駆動主体を「Orchestrator ロールを持つ何か」としてだけ規定する。
当面はメインエージェントが担い、専用 runner の導入は将来の別計画とする。

想定並列度は 2 から 4 である。

## 2. グラフスキーマ v2

破壊的に `version: 2` とする。
v1 の parser、runtime migration、互換 alias は作らない（絶対規約 3）。
既存の v1 グラフは内容を parse せず raw ファイルとして退避し、v2 で初期化する。
`version !== 2` のグラフは、いかなる変更操作よりも先に `UnsupportedGraphVersionError` で拒否する。

型は **branded type を全面採用**する。
`CommitId` と `WorkspaceId` の取り違えのような単位の混同をコンパイル時に落とすためであり、zod v4 の `.brand<>()` で実行時契約側にも同じ銘柄を与える。
zod は全 object と全 union branch を strict にし、未知キーは保持も strip もせずエラーにする（v1 の looseObject 方針は「禁止フィールドをスキーマで拒否する」契約と両立しないため引き継がない）。

```ts
declare const graphV2Brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [graphV2Brand]: Name };

type NonEmptyString = Brand<string, "NonEmptyString">;
type IsoDateTime = Brand<string, "IsoDateTime">;
type Digest = Brand<string, "Digest">;
type RepoPath = Brand<string, "RepoPath">;
type CommitId = Brand<string, "CommitId">;
type RunId = Brand<string, "RunId">;
type WorkspaceId = Brand<string, "WorkspaceId">;
type PlannedNodeId = Brand<string, "PlannedNodeId">;
type GeneratedNodeId = Brand<string, "GeneratedNodeId">;
type TaskNodeId = PlannedNodeId | GeneratedNodeId;

type Revision = Brand<number, "Revision">;
type Epoch = Brand<number, "Epoch">;
type AllocationId = Brand<number, "AllocationId">;
type AssignmentId = Brand<number, "AssignmentId">;
type ConflictId = Brand<number, "ConflictId">;
type BlockageId = Brand<number, "BlockageId">;
type NonZeroExitCode = Brand<number, "NonZeroExitCode">;

type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

type GraphSession =
  | { readonly state: "inactive" }
  | { readonly state: "active"; readonly runId: RunId; readonly epoch: Epoch };

interface GraphV2 {
  readonly version: 2;
  /** 成功した graph transaction ごとに +1。判断系ツールの OCC（§4）。 */
  readonly revision: Revision;
  /**
   * assignment / conflict / 機械生成ノードの ID を発番する永続 allocator。
   * 発番ごとに +1 し、再利用と wraparound を拒否する。
   */
  readonly nextAllocationId: AllocationId;
  readonly goal: NonEmptyString;
  readonly session: GraphSession;
  readonly nodes: readonly GraphNode[];
}

type GraphNode = StartBoundaryNode | EndBoundaryNode | ReadOnlyNode | RepositoryNode;
```

### 2.1 boundary ノード（start / end）

start / end は task ノードに偽装させず、boundary という別 kind にする。
`effect` / `assignment` / `candidate` / `resolutions` を一切持たず、機械操作だけが遷移させる（Worker / Integrator は claim できない）。

```ts
type StartBoundaryNode = {
  readonly kind: "boundary";
  readonly boundary: "start";
  readonly id: "start";
  readonly title: NonEmptyString;
  readonly deps: readonly [];
} & ({ readonly status: "pending" } | { readonly status: "done"; readonly result: BoundaryResult });

type EndBoundaryNode = {
  readonly kind: "boundary";
  readonly boundary: "end";
  readonly id: "end";
  readonly title: NonEmptyString;
  readonly deps: readonly (TaskNodeId | "start")[];
} & ({ readonly status: "pending" } | { readonly status: "done"; readonly result: BoundaryResult });

interface BoundaryResult {
  readonly kind: "boundary";
  readonly runId: RunId;
  readonly summary: NonEmptyString;
}
```

### 2.2 fence と assignment

fence は `{ nodeId, runId, epoch, assignmentId }` の**完全一致**で検査する。
`assignmentId` は allocator から発番し再利用しない（新しい run との ABA を防ぐ）。
v1 案にあった `attempt` は assignment 世代と重複するため持たない。
時間 lease（`leaseExpiry`）は持たない。`startedAt` は診断情報であり、時刻による状態遷移は存在しない。

```ts
interface AssignmentFence {
  readonly id: AssignmentId;
  readonly nodeId: TaskNodeId;
  readonly runId: RunId;
  readonly epoch: Epoch;
}

interface ReadOnlyWorkerAssignment extends AssignmentFence {
  readonly role: "worker";
  readonly effect: "read_only";
  readonly startedAt: IsoDateTime;
}

interface RepositoryWorkerAssignment extends AssignmentFence {
  readonly role: "worker";
  readonly effect: "repository_change";
  readonly workspaceId: WorkspaceId;
  readonly baseCommit: CommitId;
  readonly startedAt: IsoDateTime;
}

interface IntegratorAssignment extends AssignmentFence {
  readonly role: "integrator";
  /** canonical ではない統合用 worktree。canonical への publish は §6.4 の単一 authority だけが行う。 */
  readonly workspaceId: WorkspaceId;
  readonly startedAt: IsoDateTime;
}
```

### 2.3 成果物と candidate

`result` に三役（作業報告・conflict 入力・完了証跡）を兼ねさせない。
作業報告は `WorkReport`、candidate の由来は `Candidate.source`、完了証跡は done variant 専用の result 型に分離する。
envelope 自体の null は許さない（`data: null` は許す）。

```ts
interface WorkReport {
  readonly summary: NonEmptyString;
  readonly data: JsonValue;
}

interface Candidate {
  readonly commit: CommitId;
  /**
   * submit 時にサーバが current assignment からコピーする。
   * Worker の入力として baseCommit / workspaceId を受け取らない（Worker の申告を信用しない）。
   */
  readonly source: RepositoryWorkerAssignment;
  readonly report: WorkReport;
  readonly submittedAt: IsoDateTime;
}
```

### 2.4 統合 journal と Git 観測

canonical への merge と graph 更新は原子的にできないため、統合の進行段階を journal としてグラフに永続化し、crash 後の照合（§7）を可能にする。

```ts
interface SuccessfulCheck {
  readonly command: "mise run check";
  readonly checkedCommit: CommitId;
  readonly exitCode: 0;
  readonly outputDigest: Digest;
  readonly finishedAt: IsoDateTime;
}

interface FailedCheck {
  readonly command: "mise run check";
  readonly checkedCommit: CommitId;
  readonly exitCode: NonZeroExitCode;
  readonly outputDigest: Digest;
  readonly finishedAt: IsoDateTime;
}

type IntegrationProgress =
  | { readonly stage: "claimed" }
  | { readonly stage: "merge_prepared"; readonly integratedCommit: CommitId }
  | {
      /** canonical への CAS の前に必ず永続化する。crash 後は canonical HEAD と照合する。 */
      readonly stage: "publish_prepared";
      readonly integratedCommit: CommitId;
      readonly verification: SuccessfulCheck;
    };

interface IntegrationJournal {
  readonly assignment: IntegratorAssignment;
  readonly candidateCommit: CommitId;
  readonly canonicalHeadBefore: CommitId;
  readonly progress: IntegrationProgress;
}

interface GitObservation {
  readonly canonicalHead: CommitId;
  readonly canonicalWorktree: "clean" | "dirty" | "merge_in_progress" | "missing";
  readonly integrationWorkspace: "clean" | "dirty" | "merge_in_progress" | "missing";
}
```

### 2.5 conflict の同一性と機械生成ノードの由来

機械生成ノードの ID は allocator から発番する（`attempt` や既存 ID の文字列合成は使わない。再 conflict や区切り文字を含む ID との衝突を排除できないため）。
`start` / `end` と機械生成 namespace のノード ID を Planner は使用できない。

```ts
interface ConflictDescriptor {
  readonly id: ConflictId;
  readonly targetNodeId: TaskNodeId;
  readonly targetCandidateCommit: CommitId;
  readonly canonicalHeadAtConflict: CommitId;
  readonly files: readonly RepoPath[];
  readonly detectedAtRevision: Revision;
}

type RepositoryOrigin =
  | { readonly purpose: "planned" }
  | {
      readonly purpose: "conflict_resolution";
      readonly resolves: TaskNodeId;
      readonly conflict: ConflictDescriptor;
    };
```

### 2.6 blockage（8 種）

merge conflict・検証失敗・candidate 却下・Git 状態不確定を機械的に区別する。
実行段階と統合段階で型を分ける。

```ts
interface BlockageBase {
  readonly id: BlockageId;
  readonly reason: NonEmptyString;
  readonly occurredAtRevision: Revision;
}

type ExecutionBlockage =
  | (BlockageBase & { readonly kind: "worker_request"; readonly assignment: AssignmentFence })
  | (BlockageBase & {
      readonly kind: "worker_terminated";
      readonly assignment: AssignmentFence;
      readonly terminationEvidence: NonEmptyString;
    })
  | (BlockageBase & {
      readonly kind: "session_resumed";
      readonly assignment: AssignmentFence;
      readonly resumedToEpoch: Epoch;
    });

type IntegrationBlockage =
  | (BlockageBase & {
      readonly kind: "integration_replan_requested";
      readonly integration: IntegrationJournal;
    })
  | (BlockageBase & {
      readonly kind: "candidate_rejected";
      readonly code: NonEmptyString;
      readonly evidenceDigest: Digest;
    })
  | (BlockageBase & {
      readonly kind: "integration_conflict";
      readonly integration: IntegrationJournal;
      readonly conflict: ConflictDescriptor;
      readonly resolutionNodeId: GeneratedNodeId;
      /** conflict 記録前に canonical が clean へ戻されたことの証跡（§6.4 の cleanup 義務）。 */
      readonly canonicalAfterCleanup: { readonly head: CommitId; readonly worktree: "clean" };
    })
  | (BlockageBase & {
      readonly kind: "verification_failed";
      readonly integration: IntegrationJournal;
      readonly failure: FailedCheck;
      readonly observedGit: GitObservation;
    })
  | (BlockageBase & {
      readonly kind: "integration_state_uncertain";
      readonly integration: IntegrationJournal;
      readonly observedGit: GitObservation;
    });

type BlockedSnapshot =
  | { readonly phase: "execution"; readonly blockage: ExecutionBlockage }
  | {
      readonly phase: "integration";
      readonly candidate: Candidate;
      readonly blockage: IntegrationBlockage;
    };

interface ResolutionRecord {
  readonly previous: BlockedSnapshot;
  readonly resolution: NonEmptyString;
  readonly reopenedAtRevision: Revision;
}
```

`reopen`（`blocked → pending`）は `ramune_apply_ops` の操作列に既存の操作であり（ADR 0007）、v2 では resolution 文字列を必須にし、直前の blockage のスナップショットとともに `resolutions` へ 1 件追記する（追記はこの遷移の transaction だけが行える）。
`integration_conflict` と `integration_state_uncertain` は通常の reopen を禁止する（前者は R の統合成功で解消され、後者は §7 の照合で先に状態を確定させる）。
`verification_failed` の reopen は、observedGit が canonical clean を示していることを前提条件とする。

### 2.7 完了証跡と task ノード本体

```ts
interface ReadOnlyResult extends WorkReport {
  readonly kind: "read_only";
  readonly completedBy: AssignmentFence;
}

interface IntegratedRepositoryResult extends WorkReport {
  readonly kind: "integrated";
  readonly candidateCommit: CommitId;
  readonly integratedCommit: CommitId;
  readonly integratedBy: AssignmentFence;
  readonly verification: SuccessfulCheck;
}

interface ConflictResolvedRepositoryResult extends WorkReport {
  readonly kind: "conflict_resolved";
  readonly conflictId: ConflictId;
  readonly originalCandidateCommit: CommitId;
  readonly resolutionNodeId: GeneratedNodeId;
  readonly integratedCommit: CommitId;
  readonly verification: SuccessfulCheck;
}

type RepositoryResult = IntegratedRepositoryResult | ConflictResolvedRepositoryResult;

interface TaskNodeCommon {
  readonly kind: "task";
  readonly id: TaskNodeId;
  readonly title: NonEmptyString;
  /** task は end に依存できない。 */
  readonly deps: readonly (TaskNodeId | "start")[];
  /** blocked → pending の transaction だけが末尾へ追加できる。 */
  readonly resolutions: readonly ResolutionRecord[];
}

type ReadOnlyNode = TaskNodeCommon & { readonly purpose: "planned" } & (
    | { readonly effect: "read_only"; readonly status: "pending" }
    | {
        readonly effect: "read_only";
        readonly status: "running";
        readonly assignment: ReadOnlyWorkerAssignment;
      }
    | {
        readonly effect: "read_only";
        readonly status: "blocked";
        readonly phase: "execution";
        readonly blockage: ExecutionBlockage;
      }
    | { readonly effect: "read_only"; readonly status: "done"; readonly result: ReadOnlyResult }
  );

type RepositoryNode = TaskNodeCommon &
  RepositoryOrigin &
  (
    | { readonly effect: "repository_change"; readonly status: "pending" }
    | {
        readonly effect: "repository_change";
        readonly status: "running";
        readonly assignment: RepositoryWorkerAssignment;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "awaiting_integration";
        readonly candidate: Candidate;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "integrating";
        readonly candidate: Candidate;
        readonly integration: IntegrationJournal;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "blocked";
        readonly phase: "execution";
        readonly blockage: ExecutionBlockage;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "blocked";
        readonly phase: "integration";
        readonly candidate: Candidate;
        readonly blockage: IntegrationBlockage;
      }
    | {
        readonly effect: "repository_change";
        readonly status: "done";
        readonly candidate: Candidate;
        readonly result: RepositoryResult;
      }
  );
```

`aborted` は task ノードから削除しない。
v2 でも `ramune_apply_ops` の `abort` 操作（Planner 専用）で `pending / done / blocked → aborted` に遷移できる（§5 の表にない遷移はすべて `ramune_apply_ops` の操作列に属する）。

### 2.8 型で表現できない invariant

status union とは別に、graph レベルの invariant として transaction ごとに検査する。

- 数値は非負の safe integer。`revision` と allocator の overflow は fail-closed
- `nextAllocationId` は保存済みの全 allocation ID より大きい
- node ID は一意。deps は実在し、重複・自己参照・サイクルがない
- active な assignment の fence は graph の `session.runId / epoch` と完全一致する
- graph 全体で `integrating` は高々 1 件（§6.4）
- `Candidate.source` は submit 時の current assignment と完全一致し、`commit` は `baseCommit` の子孫
- C と R の相互参照（`resolutionNodeId` ↔ `resolves`）は 1 対 1

## 3. 排他: fenced assignment

`ramune_next_node` は削除し、選択と `pending → running` 遷移を同一トランザクションで行う `ramune_claim_ready` に置き換える。

- 決定性は維持する。ready ノード（pending かつ全 deps done）は**ノード配列の宣言順**で選び、`limit` 件を先頭から取る
- claim は fence（§2.2）を発番してノードに書き込む。以後そのノードへの完了系書き込みは fence の完全一致を要求し、不一致は型付きエラーで拒否する
- 回復は §7 の明示操作だけで行う。自動再割当は作らない

## 4. ストア: single-writer transaction

「グラフの writer は単一の ramune サーバプロセスである」ことを、§5 の transport で構造的に保証した上で、プロセス内部では次を行う。

- `GraphStore` の `load` / `save` の分離公開をやめ、全書き込みを `transaction(fn)` に集約する。`load → 検証 → 遷移 → invariant 検査 → revision + 1 → 永続化` の全体を **async mutex で明示的に直列化**する（HTTP transport ではリクエストが並行に届くため、「同期ハンドラだから事実上直列」という v1 の暗黙の性質に頼らない）
- 永続化は同一ディレクトリの一時ファイルに書き、`fsync → rename → 親ディレクトリ fsync` の atomic replace で行う
- クロスプロセスのファイルロックは作らない。二重起動の防止は §5 が担う

判断系と完了系で楽観的並行制御の粒度を分ける。

- **判断系**（`ramune_claim_ready` / `ramune_claim_integration` / `ramune_apply_ops` / `ramune_resume`）は `expected_revision` を要求する。mismatch は型付きエラーであり、**自動リトライしない**。呼び出し側がグラフを読み直し、判断からやり直す
- **完了系**（`ramune_record_result` / `ramune_submit_candidate` / `ramune_record_integration_outcome` 等）は global revision を要求せず、fence の完全一致と状態前提条件だけで競合を判定する。独立な 2 つの Worker の完了報告が revision 競合で片方潰れることを防ぐ

## 5. transport: 単一共有 HTTP サーバ（MCP spec 2026-07-28）

決定は [ADR 0013](../../adr/0013-mcp-v2-shared-http-server.md)。

- MCP SDK v2（spec revision 2026-07-28、通称 MCP v2）へ移行し、transport を stdio から Streamable HTTP に変える。spec 2026-07-28 は stateless（session ヘッダ廃止・リクエストが self-contained）であり、複数クライアントが session affinity なしで単一サーバへ接続できる
- `.mcp.json` の ramune エントリを `type: "http"` にする（同ファイルの blume-docs と同じ形）。これにより「セッションごとにサーバプロセスが spawn される」現行構造がなくなり、複数セッション・複数 worktree が同一サーバ = 同一 writer を共有する
- **port bind を排他ロックとして使う**。2 個目のサーバは bind に失敗して loudly に死ぬ。加えてサーバは起動時に graph の配置パスを自分の所有として検査し、所有の不一致は fail-closed で拒否する
- サーバの起動は `mise run mcp:ramune:serve`（`depends = ["install"]` で自分の前提を満たす。ADR 0004 の bootstrap 保証を transport 変更後も維持する）。サーバが起動していないセッションでは ramune ツールが現れず、接続失敗は明確なエラーになる。**サーバの自動 spawn による fallback は作らない**
- SDK v2 はパッケージ分割（`@modelcontextprotocol/server` 等）を伴う。採用時に公開から 7 日以上経過していることを確認する（絶対規約 10。本設計時点で経過見込みだが、実装着手時に再確認する）

## 6. 実行モデル: 隔離 worktree と直列統合

DAG 上の独立性は、変更ファイルの独立性を保証しない。
2 つのノードが依存関係を持たなくても、同じ lockfile やフォーマッタの出力を触ることはありふれている。
そのため書き込みの並列性は「作業は並列、統合は直列」で実現する。

### 6.1 Worker（repository_change ノード）

1. Orchestrator が claim 時に隔離 worktree（`workspaceId`、`baseCommit`）を割り当てて Worker を起動する
2. Worker は自分の worktree でだけ編集し、candidate commit を作って `ramune_submit_candidate` で提出する。candidate の `source` はサーバが assignment からコピーする
3. 提出をもって Worker の仕事は終わる。ノードはまだ done ではない

`effect: read_only` のノードは worktree を割り当てず、`ramune_record_result` で直接 done になる。

### 6.2 Integrator

1. Orchestrator が `ramune_claim_integration` で統合対象を 1 件確定する（journal は `claimed`）。統合可能の条件は「`awaiting_integration` であり、deps がすべて `done`」。複数候補は宣言順で tie-break する
2. Integrator は **canonical ではなく自分の統合用 worktree** で candidate を merge し、`ramune_advance_integration` で journal を `merge_prepared` に進める
3. 統合結果に対して 1 コマンド検証（`mise run check`。絶対規約 8）を実行し、成功したら journal を `publish_prepared` に進める（**canonical への CAS より先に永続化する**）
4. canonical への publish（§6.4）を行い、`ramune_record_integration_outcome` に success を渡して `integrating → done`

失敗はすべて同じツールの outcome として記録する: merge conflict は §6.3、検証失敗は `verification_failed`、candidate の内容不備は `candidate_rejected`、状態を確定できない場合は `integration_state_uncertain`。
いずれの失敗経路でも、Integrator は canonical と統合用 worktree を clean に戻してから記録する（`integration_conflict` は cleanup 証跡 `canonicalAfterCleanup` を要求する）。
失敗した変更を含む canonical の上で次の統合が始まる事態を、この cleanup 義務と §6.4 の expected HEAD 検査の二重で防ぐ。

### 6.3 integration conflict: 機械がノードを挿入する

merge conflict を検知したとき、Integrator は cleanup を済ませてから `ramune_record_integration_outcome` に conflict を渡す。
サーバは単一トランザクションで次を行う。

- 衝突したノード C を `integrating → blocked(integration_conflict)` にする。candidate は保持する
- conflict 解消ノード R を機械的に挿入する。ID は allocator から発番した `GeneratedNodeId`、`purpose: "conflict_resolution"`、`resolves: C.id`、`conflict: ConflictDescriptor`。deps は C の deps をそのまま持ち（すべて done なので即 ready）、C の deps に R の ID を追加する
- C と R の相互参照（`resolutionNodeId` ↔ `resolves`）を同時に書く

**R は通常の repository_change ノードとして扱う**。
Worker が claim して隔離 worktree で衝突を解消し、`ramune_submit_candidate` で candidate を提出し、Integrator が通常の統合工程（§6.2）を通す。
R の統合成功の transaction が、R と C（R 自身が再 conflict して R2 が生えていた場合は、その解消 chain 全体）を同時に done にする。C の完了証跡は `ConflictResolvedRepositoryResult`。

Planner の「実行中は構造変更禁止」（§5 の apply_ops）とは矛盾しない。
この挿入はサーバ内部の決定的操作であり、挿入位置の後続ノードは C を待つ pending だけだからである。

### 6.4 canonical publish: 単一 authority の CAS

canonical worktree への書き込みは、fence と expected HEAD を検証する単一の publish 経路だけが行う。

- publish は「journal が `publish_prepared` である」「fence が現在の assignment と完全一致する」「canonical HEAD が `canonicalHeadBefore` と一致する」の 3 条件を検査してから fast-forward する。いずれかが崩れていたら publish せず `integration_state_uncertain` に落とす
- graph 全体で `integrating` は高々 1 件（invariant）。よって publish の候補も常に高々 1 本
- epoch は graph の書き戻ししか fence しないため、旧 Integrator が Git を直接触る余地を「Integrator は統合用 worktree でしか作業しない + publish は上記 CAS のみ」という規範と、expected HEAD 検査という機械検査で塞ぐ

## 7. 回復: 明示操作のみ、時刻遷移なし

時刻による状態遷移は存在しない。

| 障害                        | 回復操作                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker / Integrator の死亡  | Orchestrator が**終了を確認した後**、`ramune_abandon_assignment`（fence 完全一致を要求。旧 Orchestrator の遅延した死亡確認が新 assignment を潰すことを防ぐ）。実行段階なら `blocked(worker_terminated)`、統合段階なら下記の照合へ                                                                                                                                                                  |
| 統合中の死亡（照合）        | abandon に `GitObservation` を添える。journal と観測を突き合わせ、決定的に確定できる場合だけ状態を確定する: journal が `publish_prepared` かつ HEAD が `integratedCommit` に一致 → publish 済みとして done、HEAD が `canonicalHeadBefore` に一致かつ canonical clean → candidate を保持して `awaiting_integration` へ戻す。それ以外は `blocked(integration_state_uncertain)`（fail-closed）        |
| Orchestrator / サーバの死亡 | セッション再開時に `ramune_resume` が epoch を +1 し、旧 epoch の active assignment を `blocked(session_resumed)` へ。生き残りの旧 agent の書き戻しは fence 不一致で拒否される。**`integrating` のノードが 1 件でも存在する場合、resume は型付きエラーで拒否する**（candidate と journal を保持したまま先に上記の abandon 照合で状態を確定させる。照合の機会を resume が破壊する経路を機械で塞ぐ） |
| 再試行                      | Planner が blockage を読み、resolution をグラフへ記録して `reopen` した後だけ行う（ADR 0007、§2.6 の禁止条件に従う）                                                                                                                                                                                                                                                                               |

自動リトライ、lease 失効による自動再割当、revision 競合時の自動再適用は、いずれも失敗の隠蔽（絶対規約 2）としてすべて作らない。

## 8. MCP ツール契約

`ramune_next_node` は削除する。
`ramune_apply_ops` の操作列から `set_result` を削除する。
`reopen` / `abort` / `insert_node` は従来どおり `ramune_apply_ops` の操作列であり、独立ツールにしない。
`insert_node` は既存エッジ `from -> to` を `from -> newNode -> to` に組み替える splice 専用であり、エッジの実在（`edge_not_found`）を前提条件にするため、素の `start -> end` 骨格から独立な並列ノードを2本目以降作れない（1本目の splice でエッジが消え、2本目が `edge_not_found` になる）。`insert_parallel_node`（`from, to, newNode`）はこれを解決する fan-out 専用の構造操作であり、エッジの実在を要求せず、`newNode.deps = [from]` とし `to.deps` へ `newNode.id` を追記するだけである（既存 `to.deps` は変更しない）。`to` は end boundary または pending の task に限る。実装は `tools/ramune/graph/src/operations/insert-parallel-node.ts`。

| ツール                                                      | ロール              | 契約                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ramune_read_graph()`                                       | 全ロール            | 変更なし                                                                                                                                                                                            |
| `ramune_claim_ready(expected_revision, limit, base_commit)` | Orchestrator        | ready ノードを宣言順に最大 limit 件 `pending → running` にし、fence の配列を返す。repository_change ノードには workspaceId を発番し base_commit（Orchestrator が提示する canonical HEAD）を記録する |
| `ramune_record_result(fence, report)`                       | Worker              | `read_only` ノードを `running → done`                                                                                                                                                               |
| `ramune_submit_candidate(fence, commit, report)`            | Worker              | `repository_change` ノードを `running → awaiting_integration`。source はサーバが assignment からコピー                                                                                              |
| `ramune_claim_integration(expected_revision)`               | Orchestrator        | 統合可能ノードを 1 件 `awaiting_integration → integrating` にし、journal（`claimed`）を書く                                                                                                         |
| `ramune_advance_integration(fence, progress)`               | Integrator          | journal を `merge_prepared` / `publish_prepared` へ前進させる                                                                                                                                       |
| `ramune_record_integration_outcome(fence, outcome)`         | Integrator          | success → done（`conflict_resolution` なら解消 chain を同時に done）/ conflict → §6.3 の機械挿入 / `verification_failed` / `candidate_rejected` / `integration_state_uncertain` → blocked           |
| `ramune_request_replan(fence, reason)`                      | Worker / Integrator | `blocked(worker_request / integration_replan_requested)` へ                                                                                                                                         |
| `ramune_abandon_assignment(fence, evidence, observed_git?)` | Orchestrator        | 終了確認後の回復（§7）。fence 完全一致を要求                                                                                                                                                        |
| `ramune_resume(expected_revision, reason)`                  | Orchestrator        | epoch を +1 し、旧 epoch の active assignment を `blocked(session_resumed)` へ。`integrating` ノードが存在する間は拒否（§7）                                                                        |
| `ramune_apply_ops(expected_revision, operations)`           | Planner             | `running` / `awaiting_integration` / `integrating` のノードが 1 件でもあれば拒否                                                                                                                    |
| `ramune_start(goal)`                                        | Orchestrator        | runId を発番。それ以外は従来どおり                                                                                                                                                                  |
| `ramune_end()`                                              | Orchestrator        | `running` / `awaiting_integration` / `integrating` があれば拒否                                                                                                                                     |

ready が 0 件であることを完了と解釈しない。
終了判定は従来どおり Planner が行う（ADR 0001 の非目標を維持）。

## 9. hook と role の変更

- `role.ts` に `integrator` を追加する。`.claude/agents/integrator.md`（frontmatter `name: integrator`）を新設し、Worker と同様に Orchestrator から dispatch する
- `policy.ts` の権限表を §8 の表に合わせて置き換える。`ramune_next_node` の行は削除する（互換エントリを残さない）
- hook はどの worktree の cwd からでも canonical graph の locator を解決し、解決できなければ fail-closed で拒否する
- 「Worker が canonical worktree を書かない」ことの機械強制（cwd 検査 / sandbox）は本設計の範囲外とし、write 並列の解禁前に実測する hard gate（§10）として扱う

## 10. write 並列解禁前の hard gate

次を実測で確認するまで、並列にするのは `read_only` ノードだけに留める（`repository_change` の並列度は 1 で動かす）。

1. すべての worktree のセッションが同一の ramune HTTP サーバに接続し、二重起動が port bind 失敗で loudly に落ちる（§5）
2. hook が worktree の cwd からでも canonical graph の locator を解決し、解決できなければ fail-closed で拒否する
3. Worker が canonical worktree を直接書き換えられない（規範として worker.md に明記し、可能なら sandbox で強制する）
4. canonical publish が §6.4 の 3 条件検査を全経路で通る（`integrating` 高々 1 件の invariant を含む）

## 11. 実装順序と分割

TDD で進める（絶対規約 6。テスト対象は公開契約のみ）。
work package（WP）は並列実装の分割単位であり、指示書は [20260824_parallel-execution-work-packages.md](20260824_parallel-execution-work-packages.md)。

| WP  | 内容                                                                                                                            | 依存                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| WP1 | graph v2: branded 型、strict zod スキーマ、状態機械、operations、invariant（§2 全体）                                           | なし                    |
| WP2 | `GraphStore.transaction`（async mutex）、revision、atomic persistence、v1 raw 退避（§4）                                        | WP1                     |
| WP3 | MCP ツール契約の置き換え（§8。ツール単位で内部並列可）                                                                          | WP1、WP2                |
| WP4 | hooks: `integrator` role、権限表の置き換え、graph locator の解決（§9）                                                          | WP1（ツール名一覧のみ） |
| WP5 | SDK v2 移行 + Streamable HTTP + port bind ガード + `mise run mcp:ramune:serve` + `.mcp.json`（§5）                              | WP3                     |
| WP6 | worktree 割当・統合・publish CAS・cleanup の Git 機構（§6）                                                                     | WP3                     |
| WP7 | agents 定義（planner / worker / integrator）、recipe ramune.md、AGENTS.md「ramune モード」表の更新、ADR 0010〜0013 の承認済み化 | WP3〜WP6                |
| WP8 | 並列シナリオの公開契約テスト（§12）                                                                                             | WP3〜WP6                |

WP1 と WP4 は初手から並列にできる。

## 12. テスト戦略

- 公開契約だけをテストする。graph パッケージは operations と invariant の入出力、mcp-server は MCP クライアント経由のツール呼び出し、hooks は stdin / stdout の契約
- 並列の正しさは契約の検証で担保する: claim の原子性（同一グラフに対する 2 回の claim が同じノードを返さない）、stale fence の拒否、revision mismatch の型付きエラー、`integrating` 高々 1 件、journal 段階と publish 前提条件、conflict 機械挿入と解消 chain の同時 done、abandon 照合の決定則（§7）
- v1 前提のテスト（`next-node.spec.ts`、`set-result` の Planner 経路等）は削除する。v1 の挙動を保つテストを残さない
