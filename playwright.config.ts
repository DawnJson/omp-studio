import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "screenshots/test-results",
  // Electron 应用共享 userData 和单实例锁，串行跑。
  workers: 1,
  timeout: 60_000,
  reporter: "list",
});
