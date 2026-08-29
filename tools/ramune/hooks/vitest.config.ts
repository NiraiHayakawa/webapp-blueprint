import { defineConfig } from "vitest/config";

// packages/hooks 単体の vitest 設定。ルートの vitest.config.ts は tests/policy/ 専用に
// include を絞っている（同ファイルのコメント参照）ため、ワークスペースパッケージは
// それぞれ自分のテストを走らせるための設定を個別に持つ（packages/graph と同じ方針）。
export default defineConfig({
  test: {
    environment: "node",
    // strict な tsconfig（noUnusedLocals 等）と合わせ、暗黙 globals に頼らず
    // describe/it/expect を明示 import する運用にする（ルート vitest.config.ts と同じ方針）。
    globals: false,
  },
});
