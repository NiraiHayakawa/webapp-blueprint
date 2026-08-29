# infra/ の方針

このディレクトリは Terraform の**骨格**である。`terraform apply` できる完成品ではなく、
「誰が・どこで・どの認証で apply するか」という方針だけをここに置く
（テンプレート設計 `docs/plan/Template/20260807_template-design.md` §8「インフラ」が正本）。

## CI-only の production root

- Terraform の production root は **CI からのみ apply する**。ローカルからの
  `terraform apply` は行わない
- CI は **鍵レス認証**（Workload Identity Federation）でクラウドプロバイダに
  対して認証する。長期のクラウド認証鍵を発行・保管しない
- ローカルで許されるのは `terraform plan` によるドラフト確認までで、
  実際の状態変更（apply）は PR + CI の経路だけに限定する

## `operators.tf`: infrastructure operator の権限追跡

- infrastructure operator（インフラへの変更権限を持つ人）の一覧は
  `operators.tf` で追跡する
- 追加・削除は **PR と CI apply だけ**で行う。手元で権限を直接付与しない
- **このファイルには実在するメールアドレスを書かない。** 空リストと
  コメントアウトされたプレースホルダのみを置く（`# operator_emails =
["you@example.com"]` の形）。理由は、実メールアドレスを書くと clone の
  たびに個人情報がテンプレートごと複製されてしまうため
  （受入条件9: 公開テンプレートとして個人情報の混入を防ぐため）
- プロジェクト開始時、運用者が確定した時点でこの一覧を実際の値に置き換える

## クラウドプロバイダ固有の設定は置かない

このディレクトリにはプロバイダ（GCP / AWS / Azure 等）固有の設定を書かない。
プロジェクトごとに選定が変わるため、Terraform backend・provider ブロック・
実リソース定義はここには含めない。プロバイダを選定した時点で、選定したプロバイダの
recipe（`docs/recipes/` に追加予定）を参照して埋める。

## 静的解析: tflint

- `mise run check:terraform`（`mise run check` の依存に含まれる）が
  `infra/` 配下の `.tf` を tflint で検査する。**受入条件1（対象ゼロの緑は
  不合格）** と同じ理由で、この骨格に `operators.tf` を実在させている
- provider（GCP / AWS / Azure 等）固有のルールセットは入れない。上の
  「クラウドプロバイダ固有の設定は置かない」と同じ理由で、本テンプレートは
  プロバイダを選定していないため。有効にしているのは tflint 組み込みの
  provider 非依存ルールセット（`preset = "recommended"`）だけで、
  この制約の理由は設定ファイル自身（[`.tflint.hcl`](../.tflint.hcl)）に
  コメントとして書いてある（原則4「抑制には理由を書く」と同じ発想を
  制約の記録にも適用する）
- `.tflint.hcl` は `terraform_required_version` ルールを理由つきで無効化
  している（Terraform CLI のバージョンも provider 選定と同様、プロジェクト
  開始時に決める事項のため）。理由の書かれていない抑制はゼロに保つ
  （受入条件14）

## 秘密の注入: `op run` は mise task に閉じる

- プロバイダの API トークン（Terraform provider が使う認証情報）は
  1Password から CI へ注入する
- **`op run` を通す入口は mise task に閉じる。** 「この task だけが秘密に
  触れる」ことを task 定義そのもので明示する。具体的には、Terraform を実行する
  mise task の `run` 行を `op run --env-file=<...> -- terraform ...`
  のように `op run` 越しにし、それ以外の task（`plan` の下書き確認など）
  からは秘密の実値に到達できない形にする
- CI 側に置く GitHub Secrets は **1Password Service Account トークン 1 本
  だけ**で、そこから展開する。個々のプロバイダトークンを GitHub Secrets に
  直接登録しない

この方針の詳細（`op://vault/item/field` 形式の参照のみを repo に置く・
`.env` の実ファイルを作らない・秘密の追加は vault item の作成が先で repo
変更が後、等）は原則層の正本を見る。ここでは要約し直さない。

- 原則9: [`docs/principles/secrets-by-reference.md`](../docs/principles/secrets-by-reference.md)
- 原則10（依存 pin。Terraform provider / module のバージョン pin にも適用される）:
  [`docs/principles/pin-dependencies.md`](../docs/principles/pin-dependencies.md)

## 現状のスコープ外（未実装として明記）

この骨格が置いた時点では、次のものはまだ存在しない。方針が決まっている
ことと、機械強制が既に効いていることは別であるため、区別して明記する。
**tflint による構文・言語仕様レベルの静的解析は上記のとおり導入済みだが**、
それとは別に次が未実装である:

- `operators.tf` を実際に apply する mise task（`op run` を通す入口）。
  上記の方針を体現するタスクは、Terraform backend / provider を選ぶ
  プロジェクト開始時に合わせて追加する
- `operators.tf` の記述内容そのもの（実在するメールアドレスが含まれないこと
  等）を検証する policy-as-test。tflint は Terraform 言語としての正しさは
  見るが、「メールアドレスのパターンを含まないこと」のようなこのテンプレート
  固有の内容規約までは見ない。`tests/policy/` には現時点で infra 向けの
  テストがない
- `.gitignore` への Terraform 生成物（`.terraform/`・`*.tfstate`・
  `*.tfstate.backup` 等）の追加。ルートの `.gitignore` はこの骨格の担当外
  のため未確認・未追加のままである

## この縦切りとの関係

`infra/` は §9「最小の縦切り」の対象外である。縦切りはアプリケーション層
（`apps/`・`e2e/`）だけで完結させる設計であり、`infra/` は clone 直後の
`mise run check` が対象にする範囲にも入らない。
