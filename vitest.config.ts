import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 不少单测会起真实子进程（git、假 omp、node-pty）。默认 worker 数 = 核数 - 1，32 线程的机器上同时起几十个进程，
    // 加上机器本身的负载，5 秒的默认超时会随机超（每次挂的测试都不一样，单独跑都过）。
    maxWorkers: "50%",
    testTimeout: 20_000,
  },
});
