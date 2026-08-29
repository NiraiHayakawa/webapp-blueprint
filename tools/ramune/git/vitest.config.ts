import { defineConfig } from "vitest/config";

// tools/ramune/git 単体の vitest 設定。ルートの vitest.config.ts は tests/policy/ 専用に
// include を絞っているため、ワークスペースパッケージはそれぞれ自分のテストを走らせる
// ための設定を個別に持つ（tools/ramune/graph と同じ方針）。
export default defineConfig({
  test: {
    environment: "node",
    // strict な tsconfig（noUnusedLocals 等）と合わせ、暗黙 globals に頼らず
    // describe/it/expect を明示 import する運用にする（ルート vitest.config.ts と同じ方針）。
    globals: false,
    // 各テストが実 git リポジトリを init するため、直列でも十分速いが、
    // ファイル単位では並列させて一時ディレクトリの衝突を避ける。
    pool: "forks",
  },
});
