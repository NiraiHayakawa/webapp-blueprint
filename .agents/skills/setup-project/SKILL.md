---
name: setup-project
description: bootstrap-template完了後のprojectをcloneまたはworktree作成したとき、project固有の前提を確認してcanonical setup taskを実行するときに使う。template初期化の技術選定には使わない。
---
<!-- 生成物 (scripts/sync-agent-assets.mjs) -- 直接編集しないでください。正本: .claude/skills/setup-project/SKILL.md / 再生成: mise run sync:agents -->

# setup-project

このfileはtemplate同梱の雛形である。`bootstrap-template`完了時に、選択したstackと実際のcanonical taskへ更新する。

## Guard

repository rootの`.bootstrap-template.json`を読む。分岐やpath参照より先に、JSONとしてparseし、
`schemaVersion: 1`、`status: "complete"`、非空文字列の`decisionDocument`と`setupSkill`を厳密に検証する。
fileが無い、JSON不正、必須field欠落、値不正の場合は停止し、`bootstrap-template`を案内する。
未完了projectを推測でsetupしない。

## Setup

1. markerが指すdecision documentとAGENTS.mdを読む。
2. required runtime、external account、secret参照、local serviceをdecision documentから確認する。
3. `mise run install`をcanonical install入口として実行する。
4. Codexをlinked worktreeで使う場合は、[ramuneレシピのCodex回避策](../../../docs/recipes/tools/ramune.md#codex-cliと-linked-worktree-の既知の制約)に従って、既存設定を保持したまま`~/.codex/hooks.json`へuser-level hookを登録する。project-local `.codex/hooks.json`だけではworktree上のCodex hookは発火しない。
5. project固有に追加された初期化taskを、このsectionへbootstrap時に記録された順で実行する。
6. `mise run check`でsetup後のobservable contractを検証する。

このskillへpackage managerやproviderの生commandを複製しない。決定的な処理は`mise.toml`またはscriptが正本である。

## Maintenance

setup、runtime、secret、local service、generated artifactを変えるPRでは`docs-triage`を実行し、このskillの更新要否を判定する。
canonical taskが変わった場合は同じPRで更新する。過去のstack、旧command、互換手順を残さない。
