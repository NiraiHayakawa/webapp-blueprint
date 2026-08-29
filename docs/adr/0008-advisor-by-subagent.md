# 0008. 相談先はサブエージェントで作り、ramune の全ロールに開放する

- 状態: 採用
- 決定日: 2026-08-12

## 文脈

ramune の Planner / Worker に、ファイルやグラフを変更することなく複雑な設計の選択肢や詰まりを相談できる先を与えたい。より賢いモデルに助言を求められれば、着手後の手戻りを減らせる。

Claude Code には実験的なネイティブのサーバーサイド advisor 機能が存在するが、実行環境やプロバイダ・API レベルのツール提供状況に依存しない可搬性、助言内容が暗号化・秘匿化されずにコンテキスト上で可視化される観測可能性、そして Orchestrator・Planner・Worker の各ロールから一律に呼び出せる統一的な手段が求められる。

## 決定

**相談先を「読み取り専用のサブエージェント」として作る。**

- `.claude/agents/advisor.md`: `tools` は `Read` / `Grep` / `Glob` のみ、`model` は既定 `fable`（呼び出し時に `opus` へ上書きできる）。コードを書かず、ramune のグラフにも触らない
- `.claude/skills/advisor/SKILL.md`: いつ・どう呼ぶか、受け取った助言の扱い
- **全ロール（Orchestrator / Planner / Worker）から呼べる。** そのために Planner と Worker の `tools` に `Agent` を追加する。**advisor 以外を起動しないことは規範**とし、機械では強制しない（下記「受け入れた穴」）

hook の matcher（`Edit` / `Write` と ramune の MCP ツール）に advisor は一度も触れないため、ramune 稼働中も拒否されない。「縛るのは変更であって観測ではない」（[ADR 0005](0005-ramune-restricts-mutation-not-observation.md)）と同じ理屈である。

## 理由と捨てた代替案

- **代替案 A: ネイティブのサーバーサイド advisor 機能に依存する.** 採らない。環境やプロバイダ設定による利用可否の差異に左右されるほか、助言内容が秘匿化されてクライアント側で検証できない場合がある。サブエージェント方式であれば実行環境に依存せず動作し、助言本文がそのまま読めるため呼び出し側が検証できる（[原則12](../principles/observable-by-design.md) の方向と一致する）
- **代替案 B: MCP サーバーを立てて LLM API を直接呼ぶ.** 採らない。追加の API キー管理や外部依存を持ち込むことになり、Claude Code が標準で備えるサブエージェント機構の二重実装になる。[原則3](../principles/no-compatibility-layer.md)（使わないものを痕跡として残さない）に照らしても筋が悪い
- **代替案 C: Orchestrator だけが advisor を呼び、Planner / Worker は結果経由で頼む.** 採らない。ramune のトポロジ（Planner/Worker の交互起動は Orchestrator が行う）は保てるが、相談 1 回にラウンドトリップが 2 回増える。相談は観測であり、縛る理由が無い（ADR 0005）
- **代替案 D: `Agent` を hook の matcher に入れ、`subagent_type !== "advisor"` を拒否する.** 今はやらない。実装可能（hook の stdin には `tool_input.subagent_type` が載る）だが、下記の穴が実際に踏まれてから閉じる。踏まれ方が分かってから機械化するほうが、想定だけで作るより正確になる
- **助言本文が読める観測性の利点.** ネイティブ advisor の一部挙動と異なり、サブエージェントなら助言の応答がコンテキスト上にそのまま残るため、呼び出し側や利用者が助言の根拠を検証・追跡できる（[原則12](../principles/observable-by-design.md)）

## 受け入れた穴

**Planner が `worker` サブエージェントを起動すれば、間接的にファイルを書ける。** `Agent` を渡した結果として生まれた経路であり、hook では止まらない（matcher に `Agent` が無く、入れ子で起動された `worker` の `agent_type` は `worker` なので `Edit` / `Write` が許可される）。

したがって「変更できるのは Worker だけ」という不変条件は、**機械強制としては `Edit` / `Write` の直接呼び出しに限る**という状態が一段広がった（[ADR 0006](0006-bash-outside-ramune-enforcement.md) が `Bash` について同じ判断をしている）。規範は `planner.md` / `worker.md` に明記した。閉じる方法は代替案 D に書いてある。

## 影響

- `.claude/agents/advisor.md`: 新規
- `.claude/skills/advisor/SKILL.md`: 新規（`mise run sync:agents` で `.agents/skills/` に複製され、差分は `check:agents` が拒否する）
- `.claude/agents/planner.md` / `worker.md`: `tools` に `Agent` を追加。「`Agent` は含めない」と書いていた段落を、advisor 専用である旨と `worker` を起動しない規範に差し替える
- [`AGENTS.md`](../../AGENTS.md): スキル参照一覧に `advisor` を追加し、ramune モード節に全ロール開放を書く
- ADR 0001 の「Planner/Worker の交互起動は Orchestrator が行う」は維持。ただし advisor の起動だけは各ロールが自分で行う
- `tools/ramune/hooks/src/policy.ts` の権限表コメントは変更不要。`Agent` は元々「matcher の対象外・表の参考」として記載されており、Planner/Worker がこの ADR で `Agent`（advisor 専用）を持つようになったこと自体は、その記載と矛盾しない
- 将来的にネイティブ advisor 機能がすべての環境で透過的かつ可搬に利用可能となった場合は、本設計を再評価する
