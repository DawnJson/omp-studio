// 真实 omp 冒烟：任务池 → 伪终端里的真实 omp（临时 PI_CODING_AGENT_DIR）→ 真实模型，一轮 prompt 跑完。
// 会调真实模型，默认跳过；`STUDIO_REAL_OMP=1 npx vitest run test/task-real-omp.test.ts` 才跑。需要仓库根 .env（STUDIO_TEST_MODEL 和 key）。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaskState } from "../src/shared/ipc.ts";
import { findOmpOnPath } from "../src/main/omp/discover.ts";
import { buildTspArgs } from "../src/main/omp/launch-args.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

const enabled = process.env["STUDIO_REAL_OMP"] === "1";
let scratch: string;
let pool: TaskPool | undefined;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 真实-"));
});
afterAll(async () => {
  await pool?.shutdown();
  await rm(scratch, { recursive: true, force: true });
});

describe.skipIf(!enabled)("真实 omp", () => {
  it("createTask → sendPrompt 跑到 prompt_result(completed)，任务回到 idle，会话文件落盘并记进 tasks.json", async () => {
    const dotenv = parseEnv(
      await readFile(process.env["STUDIO_ENV_FILE"] ?? path.join(import.meta.dirname, "..", ".env"), "utf8"),
    );
    const model = dotenv["STUDIO_TEST_MODEL"];
    if (!model) throw new Error(".env has no STUDIO_TEST_MODEL");
    const [provider, ...rest] = model.split("/");
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    const projectDir = path.join(scratch, "项目 目录");
    await mkdir(projectDir);

    const states: TaskState[] = [];
    const waiters: { predicate: (s: TaskState) => boolean; resolve: (s: TaskState) => void }[] = [];
    const registry = new TaskRegistry(path.join(scratch, "tasks.json"));
    pool = new TaskPool({
      registry,
      getSettings: async () => ({
        locale: "en",
        theme: "system",
        maxLiveProcesses: 6,
        reduceMotion: false,
        enterWhileRunning: "steer",
        soundOnDone: false,
        copyOnSelect: true,
        yoloConfirmed: false,
      }),
      tsp: {
        buildLaunch: async (record, project) => ({
          command: omp,
          args: buildTspArgs({
            cwd: project.path,
            // 新任务不带模型（跟随 omp 配置）；这里的临时 agent 目录没有配置，用 .env 里的测试模型。
            model: record.model ?? { provider: provider!, modelId: rest.join("/") },
            thinkingLevel: record.thinkingLevel,
            resumeSessionFile: record.sessionFile,
          }),
          cwd: project.path,
          env: { ...process.env, ...dotenv, PI_CODING_AGENT_DIR: path.join(scratch, "agent") },
        }),
        session: {
          appVersion: "0.0.0-test",
          appearance: () => ({ dark: true, reduceMotion: false }),
        },
      },
      events: {
        state: (state) => {
          states.push(state);
          for (const waiter of waiters.slice()) {
            if (!waiter.predicate(state)) continue;
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(state);
          }
        },
        notice: () => {},
        taskRemoved: () => {},
      },
    });
    await pool.init();
    const until = (predicate: (s: TaskState) => boolean) => {
      const latest = states.at(-1);
      if (latest && predicate(latest)) return Promise.resolve(latest);
      const { promise, resolve } = Promise.withResolvers<TaskState>();
      waiters.push({ predicate, resolve });
      return promise;
    };

    const project = await pool.ensureProject(projectDir);
    const created = await pool.createTask({ projectId: project.id });
    await until((s) => s.status === "idle" || s.status === "error");
    expect(pool.listTasks()[0]?.error).toBeNull();
    await pool.sendPrompt(created.id, { text: "用一句中文回答：1+1 等于几？不要调用任何工具。", whenBusy: "steer" });
    const done = await until((s) => s.lastTurn !== null && s.status === "idle");

    expect(done.lastTurn?.status).toBe("completed");
    expect(states.map((s) => s.status).filter((status, i, all) => all[i - 1] !== status)).toEqual([
      "starting",
      "idle",
      "running",
      "idle",
    ]);
    // 回答在节点树里（role omp.assistant）。
    expect(JSON.stringify(pool.getTspSnapshot(created.id).document)).toContain("omp.assistant");
    await until(() => registry.findTask(created.id)?.sessionFile != null);
    expect(registry.findTask(created.id)?.sessionFile).toContain(path.join(scratch, "agent"));
  }, 120_000);
});
