// index は re-export のみのはずだが、直接宣言を持ってしまっている（fixture 用）。
// node_modules 配下ではない正規のファイルなので、checker はこれを違反として拾わなければならない。
export function realPkgEntry(): string {
  return "real-pkg";
}
