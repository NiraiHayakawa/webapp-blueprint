# infrastructure operator の権限を追跡する。
#
# 追加・削除は PR + CI apply のみで行う（README.md 参照。ローカルからの
# `terraform apply` は行わない）。
#
# このテンプレートには実在するメールアドレスを書かない
# （テンプレート受入条件9。実メールアドレスが混入すると、
# clone されるたびに個人情報がテンプレートごと複製されるため）。
#
# プロジェクト開始時、運用者が確定したらこの default を実際の一覧に
# 置き換える。クラウドプロバイダ側のどのリソース（IAM メンバーシップ等）に
# この一覧をどう結線するかはプロバイダ選定に依存するため、本ファイルには
# 書かない（README.md「対象外にしていること」参照）。
#
# 記入例（コメントアウトのプレースホルダ。このまま有効化しない）:
# operator_emails = [
#   "you@example.com",
# ]

variable "operator_emails" {
  description = "infrastructure operator として認可するメールアドレスの一覧。"
  type        = list(string)
  default     = []
}

# プロバイダ選定前はこの変数をどのリソースにも結線できない（README.md
# 「クラウドプロバイダ固有の設定は置かない」参照）。output として公開して
# おくことで、`terraform output` から値を確認できる状態にしつつ、tflint の
# terraform_unused_declarations（宣言されたが未使用の変数を検出するルール。
# .tflint.hcl 参照）を実際の使用によって満たす。プロバイダ選定後、実際の
# リソース（IAM メンバーシップ等）への結線が入った時点でこの output は
# 削除してよい。
output "operator_emails" {
  description = "operator_emails をそのまま公開する（暫定。上記コメント参照）。"
  value       = var.operator_emails
}
