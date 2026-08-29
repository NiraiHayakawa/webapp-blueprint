---
name: commit
description: git commit を作るときに使う。gitmoji prefix・論理単位での分割・署名なしの規約を強制する。
---
<!-- 生成物 (scripts/sync-agent-assets.mjs) -- 直接編集しないでください。正本: .claude/skills/commit/SKILL.md / 再生成: mise run sync:agents -->

# commit — コミットを作る

以下の手順に従って commit を作成する。

1. `git status` と `git diff` を並行して実行し、すべての変更を確認する
2. `git log --oneline -10` で直近のコミットメッセージの傾向を確認する
3. 変更を論理単位に分割する:
   - 無関係な feature / fix / refactor が混在していれば別コミットに分ける
   - 1 コミット = 1 つの論理的な変更単位
   - 関連するファイル変更は同じコミットにまとめる
4. コミットメッセージを作成する:
   - 1 行目（タイトル）: gitmoji prefix を使う
     - `✨ feat:` 新機能
     - `🐛 fix:` バグ修正
     - `♻️ refactor:` リファクタリング（機能変更なし）
     - `📝 docs:` ドキュメント変更（`docs/` 配下・`AGENTS.md` 等）
     - `🎨 style:` フォーマット・空白（機能変更なし）
     - `✅ test:` テストの追加・更新
     - `🔧 chore:` 依存・設定などの保守作業
   - タイトルは英語・簡潔・明確に書く（例: `🐛 fix: resolve null pointer in user validation`）
   - 本文（任意）: 英語で書く。**「何を」ではなく「なぜ」に焦点を当てる**。「何を」は diff を見れば分かるため書く価値が低い
   - **署名・attribution は一切付けない**（`Generated with Claude Code`、`Co-Authored-By` 等を含めない）
5. 変更ファイルを `git add` でステージし、コミットする
6. 次の形式でコミットを作成する:

```
git commit -m "$(cat <<'EOF'
[英語のタイトル]

[任意: 英語での「なぜ」の説明]
EOF
)"
```

7. コミット後に `git status` を実行し、成功を確認する
8. 未コミットの変更が残っていれば、論理単位ごとに手順3〜7を繰り返す

## 注意事項

- secret を含むファイル（`.env`、`.env.*`、credentials 等）をコミットしない。`.secretlintrc.json` の対象であることを確認する
- コミットメッセージは「何を」ではなく「なぜ」に焦点を当てる
- 作業の進行に合わせてプロアクティブにコミットする。許可を求めるために無関係な作業をまとめてコミットしない
- **署名・attribution を絶対に付けない**（`Generated with`、`Co-Authored-By` 等いずれも不可）
- `contract/`（契約層のスロット）を含む変更は、実装より先に契約だけを進める中間状態を作らない（設計の正本 §3「契約横断の変更は1PRで原子的に行う」）。契約とそれを使う実装は同じコミット・同じ PR に含める
- push や PR 作成は明示的な指示がない限り行わない（別ステップ: [pull-request skill](../pull-request/SKILL.md)）
