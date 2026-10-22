import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 不少单测会起真实子进程（git、假 omp、node-pty）。默认 worker 数 = 核数 - 1，32 线程的机器上同时起几十个进程，
    // 加上机器本身的负载，5 秒的默认超时会随机超（每次挂的测试都不一样，单独跑都过）。
    maxWorkers: "50%",
    testTimeout: 20_000,
    // 发版脚本用 `--changed <上一个 tag>` 只跑受改动影响的单测，影响靠 import 关系算。录制和假 omp 是读文件、起子进程用的，
    // 不在 import 关系里：它们一改就跑全量。
    forceRerunTriggers: [...configDefaults.forceRerunTriggers, "**/fixtures/**", "**/test/fake-omp/**"],
  },
});
