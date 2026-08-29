# 0002. Worker から Planner への差し戻し経路（block / ramune_request_replan）

- 状態: 承認済み
- 決定日: 2026-08-08

## 文脈

0001 で確定した Planner/Worker の構造的分離には、非対称な権限しかない: Worker はグラフの
構造（`insert_node` / `reopen` / `abort`）を変更できず、`ramune_record_result` で選択中
ノードの結果を記録して `done` にすることしかできない。

この非対称は「詰まった」場面で機能不全を起こす。ゴールに対してノードの粒度が大きすぎた、
前提となる依存関係が不足していた等の理由で Worker が選択中ノードを完了できない場合、
Worker に残された手段は次の2つしかなかった。

1. 無理やり `ramune_record_result` で `done` にする（嘘の完了。グラフ上は緑になるが実際には
   終わっていない）
2. 何も記録しない（`ramune_next_node` は同じノードを何度でも返すため、次に dispatch された
   Worker が同じ壁に当たって同じ場所で止まり続ける。会話の外に状態が無いため、「なぜ止まって
   いるか」を次の Worker は知りようがない）

いずれも「詰まった」という事実そのものが構造化された状態として外在化されず、Planner が
気づいて再計画する機会が生まれない。

## 決定

- `NodeStatus` に `blocked` を追加する（`pending` / `done` / `aborted` / `blocked` の4値）
- `GraphNode` に `blockedReason: string | null` を追加する。blocked になった理由を持つ
  専用フィールドであり、`result`（遂行できた結果）とは意味が異なるため独立させる
- 新しい差分操作 `block`（`tools/ramune/graph`）を追加する。対象は `pending` のノードに限り、
  status を `blocked` にして `blockedReason` を記録するだけで、`deps` は一切変更しない
- 新しい MCP ツール `ramune_request_replan`（`tools/ramune/mcp-server`）を追加する。
  `node_id` と `reason`（必須。空文字列不可）を入力に取り、内部で `block` 操作だけを
  組み立てて適用する（`ramune_record_result` が `set_result` だけを組み立てるのと同じ形）。
  `ramune_apply_ops` の入力スキーマには `block` を含めない（「理由と捨てた代替案」参照）
- `ramune_request_replan` は Worker 専用にする（`tools/ramune/hooks` の PreToolUse hook で
  機械強制）。Orchestrator と Planner は拒否される
- `reopen` が `done` に加えて `blocked` のノードも受け付けるようにする。Planner が
  `blockedReason` を読んで `insert_node` で細分化した後、そのノードを `pending` に戻す
  手段が必要なため。`reopen` された対象ノードの `blockedReason` は `null` に戻す
- Planner（`.claude/agents/planner.md`）は `blocked` のノードを見つけたら理由を読み、
  `insert_node` で細分化するか `abort` するかを判断し、細分化した場合は `reopen` で
  解除する。Worker（`.claude/agents/worker.md`）は完了できないノードに気づいたら
  `ramune_record_result` で done にせず、`ramune_request_replan` で理由付きで差し戻す

## 理由と捨てた代替案

### `blockedReason` を `result` に混ぜず専用フィールドにした理由

`result` は「遂行できた結果」を表す。blocked は「遂行できなかった理由」であり、意味が
逆である。同じフィールドに両方を詰めると、値を見ただけでは「これは成果物か、詰まった
理由か」を型で区別できず、呼び出し側（Planner・viewer）が status を見てから result の
意味を都度解釈し直す必要が生まれる。専用フィールドにすることで、`blockedReason !== null`
であること自体が「blocked である」ことの追加の証跡になる（status と重複する情報だが、
result フィールドの意味論的な純度を保つためのトレードオフとして許容する）。

### `block` を `ramune_apply_ops`（Planner 用ツール）の入力スキーマに含めなかった理由

`GraphOperation`（`tools/ramune/graph` のドメイン層）は `block` を含む5種類の操作を持つが、
`ramune_apply_ops` の JSON Schema は意図的に4種類（`insert_node` / `reopen` / `abort` /
`set_result`）のまま変更しない。理由は0001が確立した非対称性を保つため: 「構造を決めるのは
Planner だけ」という設計上の主張を、"Worker が使える手段は `ramune_record_result` と
`ramune_request_replan` の2つの専用ツールだけであり、どちらも GraphOperation を1種類しか
組み立てられない" という形で機械的に固定したい。`block` を `ramune_apply_ops` にも公開すると、
Planner が `block` を直接発行できるようになる（それ自体は権限モデル上禁止する理由が無い
操作ではあるが）と同時に、「Worker 専用の信号を Planner 用の汎用ツールにも重複して置く」
実装上の理由が無い分岐が生まれる。ドメイン層（`GraphOperation`）とツール層（各 MCP ツールの
入力スキーマ）が1:1に対応しなくてよい、という前例は既に `set_result` が
`ramune_apply_ops`（Planner も技術的に呼べる）と `ramune_record_result`（Worker 専用の
特化ツール）の両方から組み立てられる形で存在しており、`block` はその逆（ドメインには
存在するが、あえて汎用ツール側には公開しない）の非対称を選んだ。

### `blocked` を `aborted` の一種として表現しなかった理由

`aborted` は「実行しない（しなかった）ことが決まった」終端状態であり、後続からの依存を
持たせたまま生き続けることを前提にしていない（`reopen` の対象外）。`blocked` は逆に
「Planner の判断待ちの一時停止」であり、Planner の対応（`insert_node` での細分化 +
`reopen`、または `abort`）によって解決されることを前提にした遷移中の状態である。
両者を同じ status 値に潰すと、「Worker が詰まって止まっている」ものと「もう実行しないと
決まった」ものを機械的に区別できなくなり、viewer やツール層が両者を同じ扱いにしてしまう
（例えば `ramune_next_node` の選択除外は両方に必要だが、reopen 可能性は `blocked` にしか
無い）。

### 決定的にノードの粒度を検証する仕組みにしなかった理由

「ノードが完了できないこと」を静的に検出する仕組み（例: ノードの見積もり工数の上限）は
作らない。0001 の「決定的な終了判定を実装しない」と同じ理由で、タスクの粒度が適切かどうかは
ゴールの意味を理解している Planner にしか判断できない。ramune が機械化するのは「詰まった
という事実を構造化して残すこと」までであり、「詰まった理由が正当か」「どう細分化すべきか」
の判断は LLM（Planner）に委ねる。

## 影響

- `tools/ramune/graph` の `NodeStatus` は4値になり、`GraphNode` は `blockedReason` を持つ。
  既存のノードリテラルはすべて `blockedReason` フィールドを持つ必要がある（型で強制される）
- `tools/ramune/mcp-server` は5番目の MCP ツール `ramune_request_replan` を持つ。
  `contract/README.md` の契約表を更新する
- `tools/ramune/hooks` のツール権限表に `ramune_request_replan`（Worker 専用）の行が増える
- `tools/ramune/viewer` は `blocked` を他の3状態と区別できる形（色・形の両方）で描画し、
  `blockedReason` をツールチップに表示する
- `AGENTS.md`「現在の状態」の `status` は4値・差分操作は5種類に更新する
- 今後 `blocked` の解決経路を追加で作る場合（例: Worker 自身が再試行する等）、
  「構造を決めるのは Planner だけ」という非対称を崩さないかをまずこの ADR で確認する
