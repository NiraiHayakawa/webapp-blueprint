# レシピ: 複雑度・品質ゲート(言語横断)

原則: [`docs/principles/enforce-with-machines.md`](../../principles/enforce-with-machines.md)(規約は機械で縛る)・[`docs/principles/extension-adds-files.md`](../../principles/extension-adds-files.md)(拡張はファイル追加で表現される)

## このカタログの目的

`docs/plan/Template/20260807_template-design.md` §3 が原則7(拡張はファイル追加で表現される。既存ファイルの行数純増は分割サイン)の受け皿として oxlint の複雑度・肥大系ルール(`max-lines`/`max-statements`/`max-lines-per-function`/`max-depth`/`max-params`/`max-classes-per-file`)を明示的に再有効化している。

このカタログは他の `docs/recipes/tools/*.md` と違い、単一言語のファイルに置いていない。理由は下記「なぜ言語別ファイルに置かないか」の通り、この受け皿自体が **TypeScript 専用・行数と文の数しか見ない** という2つの穴を持ち、その穴を埋めるツールが言語を横断するため。`docs/recipes/tools/README.md` の索引には「TypeScript を書く場合」「Go を backend に選ぶ場合」「Python を使う場合」のそれぞれから、このファイルへの参照を置く。

## なぜ言語別ファイルに置かないか

oxlint の複雑度・肥大系ルールには 2 つの穴がある。

1. **TypeScript 専用**。契約層で Go や Python を選んだ瞬間、原則7の受け皿が消える(`docs/recipes/tools/golang.md` の golangci-lint、`docs/recipes/tools/python.md` の lint 節はいずれも独立した設定であり、oxlint の複雑度設定を共有しない)
2. **行数と文の数しか見ない**。**認知的複雑度**(ネストの深さで重み付けした読みにくさ)を測る仕組みを oxlint(ultracite preset 込み)は持たない

この2点はどちらも「1言語のレシピ」の内側では閉じない話であり、言語別ファイルに書くと同じ記述をファイルの数だけ複製することになる(原則8「検査ロジックの二重管理を禁止」と同型の重複)。そのため単独のレシピとして切り出す。

## ツール

| ツール                                                         | 何をするか                                                                                                                                                                               | いつ要るか                                                                                                                        | テンプレの採否                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **codopsy**                                                    | tree-sitter で 35 言語を AST に解析し、循環的複雑度・認知的複雑度・構造(`max-lines`/`max-depth`/`max-params`)を言語横断で機械強制する単一バイナリ(Rust 製)。コードは実行せず静的解析のみ | 常時(既定)。原則7の受け皿のうち TypeScript 専用・行数ベースという2つの穴を埋めるため                                              | **採用**(`2.0.1`)。詳細は下記                                                                                                                         |
| ESLint `complexity` ルール(oxlint 経由)                        | 循環的複雑度(cyclomatic complexity)のみを ESLint 互換ルールとして提供                                                                                                                    | oxlint の preset が既に有効化している場合                                                                                         | **温存**(codopsy と役割は重複するが oxlint 側の preset 既定のまま変更しない。下記「oxlint の複雑度ルールとの関係」参照)                               |
| golangci-lint の `gocognit`/`gocyclo`/`cyclop`/`funlen` linter | Go 向けの循環的複雑度・認知的複雑度・関数長 linter(golangci-lint に内蔵)                                                                                                                 | Go を契約層に選んだ場合、`docs/recipes/tools/golang.md` が前提にする `linters.default: all` の opt-out 方式で自動的に有効化される | **温存(既に有効)**。Go は oxlint と違い「認知的複雑度を測れない」という穴自体が無い。codopsy との関係は下記「Go/Python を選んだ場合の再検討事項」参照 |
| radon / mccabe(Python)                                         | Python 向けの循環的複雑度計測                                                                                                                                                            | Python を契約層に選んだ場合の代替候補                                                                                             | **未評価**                                                                                                                                            |

## codopsy — 個別の丁寧な記録

### バージョン選定(原則10: 依存 pin)

2026-08-08 時点の GitHub Releases 一覧(`gh release list -R O6lvl4/codopsy`)は次の通り。

| タグ   | 公開日                     |
| ------ | -------------------------- |
| v2.2.0 | 2026-08-08(導入作業と同日) |
| v2.0.1 | 2026-05-11                 |
| v1.2.0 | 2026-03-10                 |

`v2.2.0` は公開から7日を経過しておらず、原則10「公開から一定期間(既定7日)未満のバージョンは自動採用しない」に抵触する。そのため直近で7日待機を満たす `v2.0.1` を pin した。必要な CLI フラグ(`--diff`/`--hotspots`/`--save-baseline`/`--no-degradation`/`--fail-on-warning`/`--fail-on-error`)と config スキーマ(`skipDirs`/`skipFiles`/`rules` の `severity`+`max` 形式)は `v2.0.1` の時点のソース(`src/main.rs`・`src/config.rs`)で既に揃っていることを確認済み。`v2.2.0` が公開から7日を経過した時点で `mise upgrade` の対象にできる(`mise.toml` の `minimum_release_age = "7d"` は `[tools]` の暗黙アップグレードには効くが、明示的な exact pin の初回導入には効かないため、この判断は手動で行った)。

### インストール方法

npm registry にも mise の central registry にも存在しない Rust 製の単一バイナリ。GitHub Releases にプラットフォーム別の tarball(`codopsy-{aarch64,x86_64}-apple-darwin.tar.gz` / `codopsy-x86_64-unknown-linux-gnu.tar.gz`)が置かれている。

mise の `ubi:` バックエンドでインストールできることを実測したが、`mise install` 実行時に "The ubi backend is deprecated. Use the github backend instead" という警告が出る(2026-08-08、mise 2026.8.2)。同じ tarball 命名規則は `github:` バックエンドでも解決でき、警告も出ないため、`similarity-ts`・`pkfire` と同じ `github:O6lvl4/codopsy` を採用した(`mise.toml` の `[tools]` 参照)。`github:` バックエンドは GitHub artifact attestation と SLSA provenance の検証も自動で行う(`mise install` の出力で確認)。

### `.codopsyrc.json` の内容と除外理由

**`/tools/oxlint/anti-slop/`（2026-08-18 追加）**: vendor した他所のコード（ADR 0009）。本テンプレートの複雑度予算で縛る対象ではない。除外しないと `unsafeDirectValue`（循環的複雑度 38）で `--fail-on-warning` が落ちる。oxlint 側でも同じディレクトリを `ignorePatterns` で外しており、**「vendor したものは自分の規約で測らない」という同じ判断を 2 つのツールに適用している**。

```json
{
  "rules": {
    "unused-import": false,
    "no-console": false
  },
  "skipDirs": ["/tools/architecture/test/fixtures/"],
  "skipFiles": ["pnpm-lock.yaml"]
}
```

複雑度・構造の閾値(`max-complexity`=10 / `max-cognitive-complexity`=15 / `max-lines`=300 / `max-depth`=4 / `max-params`=4)はすべて既定のまま変更していない(原則4「抑制には理由を書く」の裏返しとして、緩める場合も理由が要るため、まず既定で走らせて実際の検出結果を見た。下記「既定閾値での検出結果」参照)。

除外は次の2種類のみで、いずれも「生成物」「意図的な違反サンプル」に該当し、アプリケーションコードは除外していない。

- `skipDirs: ["/tools/architecture/test/fixtures/"]`: architecture checker(`tools/architecture/`)自身の fixture テスト。`forbidden/` 配下は意図的に規約違反を含むサンプルコードであり、oxlint の `ignorePatterns` が同じ理由で同じディレクトリを除外している(`oxlint.config.ts` 参照)のと対になる
- `skipFiles: ["pnpm-lock.yaml"]`: 生成されたロックファイル。codopsy は既定で `package-lock.json`/`Cargo.lock`/`composer.json` をスキップする組み込みリストを持つが、pnpm 用のロックファイル名は含まれていないため個別に追加した(2026-08-08、`src/utils/file.rs` の `DEFAULT_SKIP_FILES` で確認)

ルール2つの無効化は、原則4「抑制には理由を書く」・「抑制は影響範囲の狭い順に選ぶ(行→ファイル→ルール)」に基づき、次の実測結果を根拠にしている。

- **`unused-import`**: codopsy 2.0.1 のこのルールは tree-sitter の `identifier` ノードだけを使用判定の対象にしており、`type_identifier` ノード(TypeScript の型位置での参照)を見ない(`src/analyzer/rules/unused.rs` の `walk_js_usage` で確認)。そのため `import type { X } from "..."` で読み込み、型注釈としてのみ使う名前は**実際の使用状況に関わらず常に誤検出**される。2026-08-08 に既定設定で実行した結果、検出 61 件はすべてこのパターンで、手動確認した全件が誤検出だった。この懸念は型情報を持つ `oxlint --type-aware`(`eslint/no-unused-vars: deny`)が既に正しく検査しており、同日の実行で誤検出 0 件を確認しているため、二重管理にせず codopsy 側を off にした(原則8)
- **`no-console`**: 検出 16 件はすべて `scripts/`・`e2e/`・`tools/architecture/src/checker.ts` の CLI ツーリングコードで、`oxlint.config.ts` のディレクトリ別 override(`tests/policy/**`・`tools/architecture/**`・`scripts/**`・`e2e/**` で `eslint/no-console: off`)が既に意図的に許可している対象と完全に一致する。codopsy の config はディレクトリ単位の rule override を持たない(`plugins` フィールドは `CodopsyConfig` 構造体に定義があるが 2026-08-08 時点でどのルールも参照しておらず、実質未使用)ため、on のままだと将来 `apps/web`/`apps/api` 以外のツーリングディレクトリが増えるたびに個別対応が要る。oxlint 側が正しく担えている(`apps/web`・`apps/api` は `eslint/no-console: error` のまま)ため、codopsy 側は off にして判定を一本化した

### 既定閾値での検出結果(2026-08-08、`.codopsyrc.json` 導入前)

`skipDirs`(fixtures 除外)のみを設定し、`rules` を一切上書きしない状態で `codopsy analyze . -v` を実行した結果(101 ファイル):

| ルール           | 件数 | 内訳                                                                                                                                                                   |
| ---------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unused-import`  | 61   | 上記の通り全件誤検出                                                                                                                                                   |
| `no-console`     | 16   | 上記の通り全件 CLI ツーリングコードでの意図的な出力                                                                                                                    |
| `max-lines`      | 1    | `pnpm-lock.yaml`(11,517 行の生成ロックファイル)                                                                                                                        |
| `no-set-e`(info) | 1    | `.github/scripts/pr-review/common.sh` に `set -euo pipefail` が無い(info severity のため `--fail-on-warning` では失敗しない。今回のスコープ外の既存コードのため未修正) |

複雑度・構造系の違反(`max-complexity`/`max-cognitive-complexity`/`max-depth`/`max-params`)は0件だった(最大値は `tools/architecture/src/rules/layer-dependency.ts` の `evaluateReference` 関数で循環的複雑度10、既定閾値10ちょうど。閾値超過ではないため警告にはならない)。**しきい値を緩める判断は発生しなかった** — 上記の除外・無効化はすべて閾値ではなくノイズの多い個別ルールに対するものである。

除外・無効化を反映した最終状態(100 ファイル、`pnpm-lock.yaml` を skipFiles で除外)は `--fail-on-warning --fail-on-error` で exit 0、スコア A(99/100)、残る検出は前述の `no-set-e`(info)1件のみ。

### `--fail-on-warning` を使う理由

`max-complexity`・`max-cognitive-complexity`・`max-lines`・`max-depth`・`max-params` はいずれも既定 severity が `warning` であり(`.codopsyrc.json` で `severity` を明示しない限り)、`--fail-on-error` だけでは複雑度違反があっても CI が落ちない。原則7の受け皿として機能させるには `--fail-on-warning` が必須(`mise.toml` の `[tasks."check:complexity"]` 参照)。

### `-o`/`--output` を省略した場合の副作用

codopsy は `-o`/`--output` を指定しないと `codopsy-report.{format}`(既定 `codopsy-report.json`)を常にカレントディレクトリへ書き出す(`src/main.rs` の `write_output` で確認)。`mise run check:complexity` はこれを利用しつつ、生成物を `.gitignore` に追加してコミット対象から外している(標準出力にはリッチな要約が出るが `-o -` を使うと JSON の生出力のみになり `-v`/`--verbose` の per-file 表示も抑制されるため、`-o -` は使わない判断をした)。

### oxlint の複雑度ルールとの関係

oxlint の preset(ultracite)は循環的複雑度のみを検査する ESLint 互換ルール `complexity` を既定で有効にしている(2026-08-08、`oxlint --print-config` で `"complexity": "deny"` を確認。閾値は preset 側で明示的な override が無いため ESLint の既定値 20 が適用される)。これは codopsy の `max-complexity`(既定閾値10)と役割が重複する。

本テンプレートは **codopsy を正、oxlint 側の `complexity` ルールを温存(off にはしない)** という整理にした。理由:

- 閾値が違う(oxlint 20 / codopsy 10)ため、閾値を厳しくしたい場合に codopsy 側だけを見ればよい状態を保てる。oxlint 側を off にすると、preset のバージョンアップで `complexity` の既定値が変わったときに気づく手段が無くなる
- oxlint 側は型情報を持つ diagnostics(`--type-aware`)の一部として実行されるため、型エラーと同じレポートに複雑度違反が出る利点がある。一方 codopsy は認知的複雑度・構造・言語横断という preset にない情報を持つ
- 両者が同じ関数を同じ理由で赤くすることはあるが、**判定基準(cyclomatic のみ vs cyclomatic+cognitive+structure)が異なる**ため、原則8が禁じる「同じ検査ロジックの二重管理」には当たらないと判断した。将来 Go/Python の契約層を選んだ場合、その言語の linter(golangci-lint の `gocyclo` 等)と codopsy の重複が生じたときも同じ整理(閾値が異なれば併存、同じ閾値・同じ判定基準なら一方に寄せる)を適用する

`eslint/max-lines`・`eslint/max-depth`・`eslint/max-params`(oxlint、`oxlint.config.ts` で再有効化済み)と codopsy の `max-lines`/`max-depth`/`max-params` も同様に閾値が異なる可能性があるため温存する(2026-08-08 時点でどちらも既定値のまま運用しており、閾値の突き合わせは未実施。差異が実際に問題になったら再検討する)。

### Go/Python を選んだ場合の再検討事項

**Go**: `docs/recipes/tools/golang.md` が前提にする `linters.default: all` の opt-out 方式は `gocognit`/`gocyclo`/`cyclop`/`funlen` を自動的に有効化する(同ファイル §「内蔵設定の使いどころ」に `_test.go` 除外の運用が既に記載されている)。つまり **Go は TypeScript と違い、認知的複雑度を測る受け皿を最初から持っている**。codopsy を Go に対しても走らせる場合、golangci-lint の閾値と codopsy の閾値(既定 `max-cognitive-complexity`=15)が食い違う可能性があるため、契約層の ADR で「golangci-lint を正として codopsy 側は閾値を揃えるか off にする」か「両方を独立に運用し閾値の差は許容する」かを明記すること。TS の `complexity` ルール(上記「oxlint の複雑度ルールとの関係」)と同じ整理をそのまま流用できる。

**Python**: `docs/recipes/tools/python.md` の lint 節(ruff)は 2026-08-08 時点で複雑度系ルール(`C901` 等)を個別に評価していない。Python を選んだ場合は、ruff 側で複雑度ルールを有効化するか codopsy に一本化するかを ADR で判断すること。

### セルフドッグフーディング(参考)

codopsy 自身の CI(`O6lvl4/codopsy` リポジトリの `cargo test` / README「Development」節)は「codopsy が自分自身のソースを解析して落ちたら CI を落とす」という運用をしている(`codopsy analyze ./src` を CI 要件にしている)。これは本テンプレートの原則4「checker 自身が fixture テストを持つことを必須にする」と同じ発想を検査対象そのものに適用した実例であり、外部ツールでも同種の規律が独立に採られていることの傍証として記録する。

## まとめ: このレシピの配線状況

- `mise.toml` の `[tools]` に `"github:O6lvl4/codopsy" = "2.0.1"` を pin(実体層)
- `[tasks."check:complexity"]` を追加し、`[tasks.check].depends` に含める(実体層)
- `.github/workflows/ci.yml` の matrix に `"check:complexity"` を追加(実体層)
- `.codopsyrc.json`(実体層)。上記の除外・無効化のみで、アプリケーションコードは除外していない
- `.gitignore` に `codopsy-report.json` を追加(実体層。生成物のコミット禁止)
