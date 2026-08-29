---
name: bootstrap-template
description: webapp-blueprintをcloneした直後、project固有コードの実装前に、project briefの調査、技術discussion、依存順の質問、stack materializationを完了するときに使う。完了済みprojectの通常setupには使わない。
---
<!-- 生成物 (scripts/sync-agent-assets.mjs) -- 直接編集しないでください。正本: .claude/skills/bootstrap-template/SKILL.md / 再生成: mise run sync:agents -->

# bootstrap-template

このskillはtemplateをprojectへ変換する初回専用workflowである。質問仕様とnode graphの正本は
[bootstrap-template質問仕様](../../../docs/plan/Template/20260828_bootstrap-template.md)。このskillはその実行手順だけを持つ。

## Entry guard

1. repository rootの`.bootstrap-template.json`を確認する。
2. markerがある場合は分岐前にJSONとしてparseし、`schemaVersion: 1`、`status`、`decisionDocument`、`setupSkill`の型と値を厳密に検証する。JSON不正、未知のstatus、必須field欠落ならfail fastする。
3. 検証済みmarkerの`status`が`complete`なら再実行を拒否し、markerの`setupSkill`を案内する。
4. markerがなければbootstrapを開始する。ユーザーが決めていない事項をtemplate既定値で補わない。
5. `grill-with-docs` skillが利用可能か開始前に確認する。利用不能なら質問を始めず、READMEに記載した必須prerequisiteを案内して停止する。

## Stage 1: project brief and research

1. ユーザーへ「何を作りたいか」を自由記述で聞く。
2. `grill-with-docs`を必ず起動する。利用不能なら代替interviewへ切り替えず、必要なskillが無いことを明示して停止する。
3. `grill-with-docs`の`grilling`と`domain-modeling`で、目的、利用者、phase、主要な境界、制約をresearch可能なproject briefにする。
4. 同じ`grill-with-docs` sessionでrepository正本と最新の外部一次情報をまとめて調査する。
5. research outputにrecommendation、根拠、trade-off、未解決点、参照した一次情報を含める。

## Stage 2: technical discussions

質問仕様の「research後、question workflow前に完了するtechnical discussion」を読む。project briefとresearchから
open条件を満たすdiscussionだけを開く。

- Agentの現在の理解とrecommendationを先に提示する。
- 固定選択肢へ押し込まず、ユーザーの補足と訂正からdecisionを形成する。
- 該当しないdiscussionは理由付きで`skipped`にする。
- project固有の重大な未決事項を見つけたら、既存discussionで扱えない理由と影響範囲を示して追加する。
- すべてのopen discussionが`decided`または`skipped`になるまでquestion nodeを開かない。

## Stage 3: question workflow

質問仕様のcanonical node graphとquestion node registryに従う。最初のnodeは必ず`Q0`（Go / TypeScript）。

- predecessorが完了したnodeだけを開く。
- 同じnodeの質問はrecommendation、根拠、主要trade-offと一緒にまとめて提示する。
- node内の回答が後続質問の意味を変える場合、その質問を別nodeへ分割する。
- 条件付きnodeはopen条件またはskip条件のどちらかを明示的に確定する。
- 回答矛盾、未回答の必須質問、skip条件不明の状態で後続nodeへ進まない。
- discussionへ戻る必要が生じたら質問を中断する。必要な差分researchと追加discussionを終えてからworkflowを再生成する。

決定状態は`docs/design/project-bootstrap.md`へ逐次上書きする。最低限、project brief、research sources、discussion state、
node / question ID、回答、recommendation、根拠、open / skipped理由、materialization先を記録する。履歴を追記せず、現在状態だけを保つ。

## Stage 4: materialization

すべての必須・条件付きnodeが完了してから開始する。

1. 各decisionへ`docs-triage`を適用する。
2. 静的に検査できる規約はlinter、ast-grep、architecture test、policy testへ置く。
3. 決定的な処理は`mise` taskまたはscriptへ置き、skillへcommand列を複製しない。
4. hard to reverse、surprising、real trade-offをすべて満たすdecisionだけを`adr` skillで記録する。
5. 選ばなかったstackのdependency、実装、互換layerを残さない。PR AI review workflowだけは回答に従い明示的disabledで保持できる。
6. `setup-project/SKILL.md`をprojectの実構成、必要なexternal prerequisites、canonical taskへ更新する。

## Stage 5: completion

1. `mise run sync:agents`を実行する。
2. `mise run check`を実行し、失敗を解消する。検査をskipして完了扱いにしない。
3. READMEのbootstrap案内を`setup-project`案内へ置き換える。
4. AGENTS.mdのskill参照を`bootstrap-template`から`setup-project`へ置き換える。CLAUDE.mdはAGENTS.mdのimportだけを正本とする。
5. 変更後に再度`mise run sync:agents`と`mise run check`を成功させる。
6. 最後の変更としてrepository rootへ次のmarkerを作る。

```json
{
  "schemaVersion": 1,
  "status": "complete",
  "decisionDocument": "docs/design/project-bootstrap.md",
  "setupSkill": ".claude/skills/setup-project/SKILL.md"
}
```

markerを書く前に停止した場合は未完了である。markerの存在だけでなく上記schemaを厳密に検証する。
