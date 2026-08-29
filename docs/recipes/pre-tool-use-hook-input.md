# レシピ: PreToolUse フック入力の実測仕様(メイン/サブエージェントの違い)

原則: [`docs/principles/knowledge-flows-back.md`](../principles/knowledge-flows-back.md)(知見は正本へ還流する)、[`docs/principles/fail-fast.md`](../principles/fail-fast.md)

このファイルは `tools/ramune/hooks`(ramune の Orchestrator/Planner/Worker ロール判定)を実装する過程で実測した、Claude Code の PreToolUse フックの stdin の形についての調査ログである。レシピ層に置くのは、**この入力スキーマが公式ドキュメント(https://code.claude.com/docs/en/hooks)には明記されておらず**、実測でしか確認できなかった情報だからである(次に同じ実測をやり直さずに済むようにする)。

## 経緯: なぜ実測が必要だったか

`tools/ramune/hooks/src/role.ts` の初期実装は、公式ドキュメントの "Common input fields" 節にある次の記述だけを根拠に `agent_id` の有無で Planner/Worker の2値判定をしていた。

> `agent_id`: Unique identifier for the subagent. Present only when the hook fires inside a subagent call.
> `agent_type`: Agent name (for example, "Explore" or "security-reviewer"). Present when the session uses `--agent` or the hook fires inside a subagent. For subagents, the subagent's type takes precedence over the session's `--agent` value.

この記述だけでは、実際に「メインエージェント」と「Agent ツールで起動されたサブエージェント」の双方で PreToolUse hook の stdin に**どのキーの組み合わせ**が来るのかが分からなかった。特に `agent_type` は「メインスレッド自身が `--agent` フラグ付きで起動された場合にも設定されうる」と書かれているため、`agent_type` の有無だけでは「メインエージェントか subagent 内か」を区別できないと当初は判断していた。この判断が誤りだったことが、後述の ramune のトポロジ変更(Orchestrator/Planner/Worker の3ロール化)の過程で判明した。

## 観測方法（再現手順）

`claude -p` を使って次の順でツール呼び出しを行い、都度 PreToolUse hook の stdin をファイルにダンプして確認する。

1. メインエージェントが `Read` ツールを呼ぶ
2. メインエージェントが `Agent` ツールでサブエージェント（例: `name: custom-worker` を持つ `.claude/agents/custom-worker.md`）を起動する
3. 起動されたサブエージェントが `Read` ツールを呼ぶ

## 観測結果

| 呼び出し元                                         | 観測されたキー                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| メインエージェントの `Read`                        | `cwd, effort, hook_event_name, permission_mode, prompt_id, session_id, tool_input, tool_name, tool_use_id, transcript_path` |
| メインエージェントの `Agent`(サブエージェント起動) | 同上(`agent_id` / `agent_type` は無い)                                                                                      |
| サブエージェントの `Read`                          | 上記 + `agent_id` + `agent_type`                                                                                            |

サブエージェント側の実値の例:

```json
{
  "tool_name": "Read",
  "agent_id": "a6f93a5a273faf7d7",
  "agent_type": "custom-worker",
  "session_id": "...",
  "permission_mode": "auto"
}
```

## 分かったこと

- `agent_id` / `agent_type` は**セットで現れる**。メインエージェントにはどちらも無く、サブエージェントにはどちらもある。片方だけが存在するケースは観測されていない
- `agent_type` には**サブエージェント定義ファイル(`.claude/agents/*.md`)の frontmatter の `name` がそのまま入る**。上の例では `.claude/agents/custom-worker.md` の `name: custom-worker` が一致する。つまり `agent_type` を見れば、どのサブエージェント定義から起動されたかが名前で直接分かる
- 公式ドキュメントの「`agent_type` は `--agent` フラグでメインスレッドにも設定されうる」という記述自体を否定する観測はできていない(`--agent` フラグを付けたメインスレッドの起動は今回の観測手順に含まれていない)。ただし ramune はこのケースを踏まない設計にした(次節)

## この観測を受けて ramune が採った設計

ramune は「メインエージェントが Orchestrator として Planner / Worker のサブエージェントを交互に起動する」トポロジに固定し、`--agent <name>` でメインスレッド自体を起動する運用は採らない。これにより `agent_type` は常に「ramune の3ロールのうちどれか」を一意に決める鍵として使える(`tools/ramune/hooks/src/role.ts` の `determineRole` 参照):

- `agent_type` が無い → Orchestrator(メインエージェント)
- `agent_type === "planner"` → Planner
- `agent_type === "worker"` → Worker
- それ以外の `agent_type` → fail-fast で拒否(未知のサブエージェントを既定ロールにフォールバックしない)

判定根拠を `agent_id` の有無から `agent_type` の値に変えたのは、`agent_id` は「サブエージェントかどうか」の2値情報しか持たないのに対し、`agent_type` は「どのサブエージェントか」まで名前で特定できるため、3ロール(Orchestrator/Planner/Worker)化した ramune の要件によりよく合致するからである。

## 付記: `.claude/settings.json` の matcher が `Agent` を含まない理由

`.claude/settings.json` の PreToolUse hook の matcher は次の通りで、`Agent` ツールを含まない。

```
mcp__ramune__ramune_read_graph|mcp__ramune__ramune_next_node|mcp__ramune__ramune_apply_ops|mcp__ramune__ramune_record_result|Bash|Edit|Write
```

`Agent` ツール(サブエージェント起動)が matcher に無いため、Orchestrator が Planner/Worker を起動する呼び出しではそもそも PreToolUse hook が発火せず、常に許可される。これは ramune の設計上の意図通りである — Orchestrator が Planner/Worker を dispatch できることは大前提であり、`tools/ramune/hooks` が制限すべきは「Orchestrator がグラフの構造を直接変更したり、直接ツールを実行したりできないこと」(`ramune_apply_ops` / `ramune_record_result` / `Bash` / `Edit` / `Write` への直接アクセス)であって、「サブエージェントを起動できること」ではない。そのため matcher に `Agent` を追加する必要はない。

## 付記: MCP ツールの `tool_name` には `mcp__<server名>__` prefix が付く

`tools/ramune/hooks/src/policy.ts` の `resolveDecision` でツール名を bare 名（`ramune_read_graph` 等）で登録すると、matcher に書かれた prefix 付きの名前（`mcp__ramune__ramune_read_graph`）と突き合わせが取れず、すべての MCP ツールが `UnknownToolError` で拒否される。matcher 自体は正しく発火しているが、hook 関数内部の突き合わせが誤っている形になる。

PreToolUse hook の stdin の `tool_name` は、ビルトインツール（`Bash`/`Edit`/`Write`）は bare のまま渡ってくるが、MCP ツールは常に `mcp__<server名>__<tool名>` の形で渡ってくる。`tools/ramune/hooks/src/policy.ts` が権限判定に使うツール名の集合（`SHARED_TOOLS` / `PLANNER_ONLY_TOOLS` / `WORKER_ONLY_TOOLS`）は、実際に stdin へ来る値（= matcher と同じ prefix 付きの値）に合わせる必要がある。「読みやすいから」「契約層の `name` と揃えたいから」といった理由で bare 名を policy.ts 側に残すと、全 MCP ツールが静かに拒否され続ける（hook は fail-closed なので、症状は「ツールが常に deny される」という分かりやすい形で出る一方、原因は一見無関係な文字列の prefix 有無になるため気づきにくい）。
