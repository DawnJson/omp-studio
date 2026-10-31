import os from "node:os";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  // 每个用例自己起 Electron（launch.ts：临时 userData 和单实例锁、临时 agent 目录、CDP 口取 0），用例之间不共享状态，
  // 所以按用例并行（同一个文件里的用例也分到不同 worker）。整台机器共用的只有系统剪贴板：写了再读 / 粘贴的那一段拿
  // launch.ts 的 lockClipboard。
  fullyParallel: true,
  // 默认八分之一的逻辑核（32 线程的开发机上 4 个）：跑 e2e 时机器还要给人用。每个 worker 同时只有一个应用
  // （Electron 几个进程 + omp），4 个 worker 的被测进程平均约 5 个核、峰值约 2 GB 内存。临时要改就 `--workers N`。
  // 量过的数见 docs/architecture/testing.md「e2e 并行」。
  workers: Math.max(1, Math.floor(os.availableParallelism() / 8)),
  // CI 上留着 test.only 就直接失败，免得只跑了一条还显示通过。
  forbidOnly: !!process.env["CI"],
  timeout: 60_000,
  reporter: "list",
  // 开跑前查 out/ 不比 src/ 旧；跑完查没有新留下的临时目录（返回的函数就是 globalTeardown）。见 test/e2e/global-setup.ts。
  globalSetup: "./test/e2e/global-setup.ts",
});
