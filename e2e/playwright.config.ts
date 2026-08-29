// playwright.config.ts
// これは配線の実証であり、消して始めてよい（docs/plan/Template/20260807_template-design.md §9）。
//
// ビルド済みフロント（apps/web/dist）だけを対象にする。バックエンドには繋がない。
// E2E は mise run check には含めず、main マージ時にのみ実行する（§9 末尾 / mise.toml "test:e2e"）。

import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

const baseURL = "http://127.0.0.1:4173";

const testDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
});

export default defineConfig({
  testDir,
  fullyParallel: true,
  reporter: "line",
  webServer: {
    command: "node ./serve-built-frontend.mjs",
    url: baseURL,
    reuseExistingServer: false,
  },
  use: {
    baseURL,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
