import { defineConfig } from "vitest/config";

// apps/web 専用の vitest 設定（理由は apps/api/vitest.config.ts と同じ）。
//
// environment は "node" のままにしている: このパッケージの vitest 対象
// （components / features）は DOM API に依存しない純粋関数として実装しており、
// jsdom 等は catalog に pin されていないため導入しない
// （report に明記。実 DOM の検証は e2e/ の Playwright が担う）。
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
  },
});
