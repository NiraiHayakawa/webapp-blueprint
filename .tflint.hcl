# webapp-blueprint の tflint 設定。
#
# 由来: docs/plan/Template/20260807_template-design.md の実装計画
# 「tflint — 今すでにある穴」。infra/operators.tf は実在する Terraform
# コードだが静的 lint が一切かかっていなかった（infra/README.md 参照）。
#
# provider プラグイン（aws/gcp/azure 等）は入れない。infra/README.md
# 「クラウドプロバイダ固有の設定は置かない」と同じ理由で、本テンプレートは
# クラウドプロバイダを選定していない。plugin "aws" のようなプロバイダ固有
# ルールセットは、選定したプロバイダの recipe（docs/recipes/、プロジェクト
# 開始時に追加）側で足す。
#
# 有効にするのは tflint に組み込まれている provider 非依存の "terraform"
# ルールセット（Terraform 言語そのものの規約。
# https://github.com/terraform-linters/tflint-ruleset-terraform）だけ。
# さらに preset = "recommended" に絞る。preset を指定しないと同ルールセットの
# 全ルールが有効になり、命名規則の強制やドキュメント文字列の必須化のような、
# まだプロジェクトが選んでいないスタイル選好まで強制してしまうため。
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

config {
  format = "compact"
}

# --- 抑制（原則4「抑制には理由を書く」。docs/principles/enforce-with-machines.md） ---

# terraform_required_version（recommended preset に含まれる）は
# `terraform { required_version = ... }` の記述を必須にするルール。
# 本テンプレートは Terraform CLI のバージョンをまだ選定していない
# （provider 未選定と同じ理由: infra/README.md「クラウドプロバイダ固有の
# 設定は置かない」を参照。CLI バージョンの選定もプロジェクト開始時に行う
# 決定であり、テンプレートの時点で固定すると根拠のない値になる）。
# プロジェクト開始時、Terraform バージョンを選定したらこのルールを再度
# 有効化し、required_version を書くこと。
rule "terraform_required_version" {
  enabled = false
}
