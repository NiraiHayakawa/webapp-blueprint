// tools/ramune/git のテスト用 fixture の公開入口。
//
// 実 git リポジトリの組み立て（createGitRepo / commitFile / revParseHead）は、
// このパッケージ自身のテストと、mcp-server の統合シナリオテストのように
// 「ramune-git を実走させる別パッケージのテスト」の双方から必要になる。fixture を
// パッケージ公開面のサブパスとして出すことで、同じ手順が各所に複製されることを
// 防ぐ（similarity ゲートが重複を拒否する）。ランタイム API ではないため "." とは
// 別サブパスに分けてある。
export {
  runTestGit,
  revParseHead,
  commitFile,
  createGitRepo,
} from "./test/support/fake-git-repo.ts";
export type { CommitSpec } from "./test/support/fake-git-repo.ts";
