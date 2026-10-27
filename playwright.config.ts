import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  // 每次启动有自己的 userData 和单实例锁（launch.ts 用 mkdtemp），但系统剪贴板是整台机器共用的：clipboard.e2e.ts、
  // tsp.e2e.ts 写了又读，并行时互相覆盖。所以串行跑。
  workers: 1,
  // CI 上留着 test.only 就直接失败，免得只跑了一条还显示通过。
  forbidOnly: !!process.env["CI"],
  timeout: 60_000,
  reporter: "list",
});
