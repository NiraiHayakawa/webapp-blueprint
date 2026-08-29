# 0009: anti-slop の 15 ルールを vendor して全面採用する

- 日付: 2026-08-18
- 状態: 承認済み

## 文脈

原則 4「規約は機械で縛る」は、散文で書いた規約を最後の手段とし、機械強制できるものは機械に移すことを要求する。この受け皿として oxlint に ultracite preset を extends している（[ADR 0002](0002-worker-replan-signal.md) §2026-07-13 の判断に合わせた形）。

[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) は、その preset には無いルールを 15 個持つ oxlint の JS プラグインである。`unknown` の安易な伝播、アドホックな `typeof` による絞り込み、根拠コメントの無い型アサーション、値契約の曖昧な辞書型など、「型検査を形式上通過させるが根拠が弱い書き方」を機械的に検出・禁止する。

また、モジュールモックを禁止する `no-module-mocking`（`vi.mock` 等の禁止）は、本テンプレートが採用する DDD の port / adapter（実物の差し替え口を設計として持つ構造）と自然に合致し、余計なモックへの依存を抑制する。

## 決定

15 ルールすべてを "error" で採用し、検出された指摘は原則としてコード側の型定義と境界契約の是正によって解決する。例外的な制約（`node_modules` 解決を持てないブートストラップコード等）でのみ行単位の理由付き抑制を適用する。

プラグインは npm 依存ではなく `tools/oxlint/anti-slop/` に vendor する（anti-slop 自身が vendor 前提で配布されている）。

ルールごとの位置づけや vendor 運用の詳細は [docs/recipes/tools/typescript.md](../recipes/tools/typescript.md) の「anti-slop — 個別の丁寧な記録」を正本とする。

## 理由と捨てた代替案

- **代替案 A: 設計と一見衝突しない一部のルールのみを選択的に採る.** 採らない。手書きの境界パーサが `no-unknown-parameters` や `no-runtime-typeof` で指摘されるケースは、ルール自体の誤検知ではなく「境界パースを手で書いていること（スキーマや明確な型契約への委譲が不足していること）」を示している。ルールを除外するのではなく、コード側の境界設計を正すことで型安全性を高める。

- **代替案 B: 幾何図形名と衝突する `no-shape-in-symbol-names` を除外する.** 採らない。SVG などの幾何図形名（`triangleShapePoints` 等）と構造型の "shape"（`isGraphShape` 等）を linter が区別できないとしても、幾何側のシンボル名をリネーム（`trianglePoints` / `renderNode` 等）する方が、ルール全体を緩めるよりも保守性が高い。

- **代替案 C: npm パッケージ依存として導入する.** 採らない。anti-slop はリポジトリへ vendor して管理することを前提として配布されている。また、ルール実装が手元にあることで、原則 4「抑制には理由を書く」の判断材料を直接確認できる。

- **`Record<string, unknown>` の扱い（`no-unsafe-dictionary-type`）について.** ログ等の開いたフィールド袋において、`Record<string, unknown>` は値の契約が曖昧である。JSON 直列化されるログ契約に合わせて `Record<string, JsonValue>` と定義することで、ルールを満たすと同時にドメインの型契約がより正確になる。

## ADR 0004 との衝突（解決済み・例外箇所の扱い）

`tools/ramune/hooks/src/role.ts` などのブートストラップコードは、[ADR 0004](0004-harness-bootstrap.md)（PreToolUse hook のソースは `node_modules` の解決を要する import を持たない）の制約下にある。外部ライブラリ（zod 等）を import できないため、実行時検証に `typeof` を用いる必要がある。

このような不可避の外部制約が存在する箇所に限り、linter を欺く難解なコードへの書き換えやディレクトリ単位の広範な無効化を避け、行単位の抑制コメント（`// oxlint-disable-next-line ...`）と明示的な理由を付与して局所的に解決する（[原則4](../principles/enforce-with-machines.md): 散文は最後の手段）。

## 影響

- `docs/recipes/tools/typescript.md` の lint 表に行を追加し、詳細節「anti-slop — 個別の丁寧な記録」を新設する
- `oxlint.config.ts` に `jsPlugins` 登録と 15 ルールの有効化を追加する
- `pnpm-workspace.yaml` の catalog に `@oxlint/plugins` を追加する。**`oxlint` と同じバージョンに固定する必要がある**ため、catalog 上で隣接させる（原則 10）
- ルート `AGENTS.md`「絶対規約」節は**変更しない**。anti-slop が縛るのは機械強制できる範囲であり、AGENTS.md は「機械強制できない普遍規範のみを置く」ことになっている（原則 4）。境界パースの要求は原則 2「fail fast」の具体化にあたるが、原則の文面を変えずに機械の側が強くなった形なので、原則ファイルの更新も不要
- `docs/principles/enforce-with-machines.md` の「今どの機械が強制しているか」の記述は、原則ファイルがツール名を持たない設計であるためレシピ側への参照で足り、更新不要
