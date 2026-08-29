import { defineConfig } from "vitest/config";

// packages/mcp-server 単体の vitest 設定（packages/graph/vitest.config.ts と同じ方針）。
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
  },
});
