---
name: advisor
description: 設計の分岐で迷ったとき・詰まったとき・着手前に方針を確かめたいときに、より賢いモデル（Fable 5 / Opus 5）へ助言を求める。ramune の全ロール（Orchestrator / Planner / Worker）から使える。
---
<!-- 生成物 (scripts/sync-agent-assets.mjs) -- 直接編集しないでください。正本: .claude/skills/advisor/SKILL.md / 再生成: mise run sync:agents -->

# advisor — より賢いモデルに相談する

`Agent` ツールで `subagent_type: "advisor"` を起動する。決定ログは
[ADR 0008](../../../docs/adr/0008-advisor-by-subagent.md)。

## いつ呼ぶか

- **着手前**（設計の分岐を選ぶ前）。着手後に方針を変えるより安い
- **詰まったとき**（同じエラーが繰り返す、approach が収束しない、ゲートが落ち続ける）
- **方針転換を考えたとき**
- Planner なら: 分解の粒度、依存順序に複数の妥当な解があるとき、`blockedReason` が
  細分化で済むのか仕様判断が必要なのかの切り分け、終了判定に自信が持てないとき
- Worker なら: `ramune_request_replan` で差し戻す前（本当に担当範囲外か確かめる）

呼ばなくてよいのは、次の一手が直前のツール出力で決まっている短い反応的な作業。

## どう呼ぶか

```
Agent(
  subagent_type: "advisor",
  model: "fable",        // または "opus"
  prompt: <問い + 判断に必要な文脈>
)
```

**モデルの選び方**: 既定は `fable`（`advisor.md` の frontmatter も `fable`）。
設計の筋読みや仕様解釈のように「賢さが効く」問いは `fable`。実装の詰まりの
切り分けのように「コードの読解量が効く」問いは `opus` でよい。迷ったら `fable`。

**会話履歴は渡りません。** advisor はあなたの文脈を見られないので、prompt に
自分で書く:

- 何を判断したいのか（選択肢を列挙する）
- 判断に必要な抜粋（仕様・ADR・該当コード・エラー出力）か、**読むべきファイルのパス**
- すでに試したこと・分かっていること
- 制約（守るべき原則、既存の決定）

パスを渡せば advisor は自分で `Read` / `Grep` / `Glob` して確かめます。抜粋を
貼るより、パスを渡すほうが正確なことが多い。

## 受け取った助言の扱い

- **検証の代わりにはならない。** 助言に沿って書いたコードも `mise run check` を
  自分で通す
- **仕様判断の代わりにはならない。** 仕様書が「後で決めること」としている事項は
  advisor に埋めさせず、ユーザーに確認する（Worker なら
  `ramune_request_replan` で差し戻す）
- **自分の実測が助言と食い違ったら、黙って助言に従わない。** 食い違いを添えて
  もう一度聞くか、実測を優先する理由を結果に書く
- **advisor はコードを書けない。** 「advisor に直させる」ことはできません
  （`Edit` / `Write` / `Bash` を持たない読み取り専用のロール）

## ramune 稼働中の扱い

全ロールから呼べます。advisor は `Read` / `Grep` / `Glob` しか使わないため、
PreToolUse hook の matcher（`Edit` / `Write` と ramune の MCP ツール）に一度も
触れず、拒否されません。「縛るのは変更であって観測ではない」
（[ADR 0005](../../../docs/adr/0005-ramune-restricts-mutation-not-observation.md)）と
同じ理屈です。
