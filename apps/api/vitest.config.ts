import { defineConfig } from "vitest/config";

// apps/api 専用の vitest 設定。
//
// ルートの vitest.config.ts は tests/policy/ 専用に include を絞っている
// （そちらのコメント参照）。vitest はワークスペースパッケージ自身が
// vitest 設定を持たない場合、config 探索でルートの設定まで遡って使ってしまい、
// このパッケージのテストが「対象ゼロ」になる（実測済み）。
// そのためワークスペースパッケージ側にも最小限の設定を置く。
export default defineConfig({
  test: {
    environment: "node",
    // ルートの vitest.config.ts と揃える: 暗黙 globals に頼らず
    // describe/it/expect を明示 import する運用にする。
    globals: false,
  },
});
