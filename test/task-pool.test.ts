// 任务池：进程上限、回收、归档、恢复历史会话、失败路径、启动过程中的归档和退出。
// 进程是 test/fake-omp/fake-tsp-omp.ts（伪终端里回放 fixtures/tsp 的录制）；任务状态推导和 omp 交互见 test/task-tsp.test.ts。
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProjectId, StudioSettings, TaskId, TaskState } from "../src/shared/ipc.ts";
import type { TspEvent } from "../src/shared/tsp/tsp.generated.ts";
import { IDLE_RECYCLE_MS, TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";
import { loadTspFixture, recordedUserEvents } from "./tsp-fixtures.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeTsp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  // 路径带空格和中文：开发机上就有这种路径。
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 任务池-"));
  projectDir = path.join(scratch, "项目 一");
  await mkdir(projectDir);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const settings = (maxLiveProcesses = 6): StudioSettings => ({
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  copyOnSelect: true,
  yoloConfirmed: false,
});

/** 收集池推送的事件；`until` 等到某个任务的状态满足条件（事件驱动，没有固定等待）。 */
class Events {
  states: TaskState[] = [];
  removed: TaskId[] = [];
  #waiters: { predicate: (state: TaskState) => boolean; resolve: (state: TaskState) => void }[] = [];

  readonly sink = {
    state: (state: TaskState) => {
      this.states.push(state);
      this.#waiters = this.#waiters.filter((waiter) =>
        waiter.predicate(state) ? (waiter.resolve(state), false) : true,
      );
    },
    notice: () => {},
    taskRemoved: (id: TaskId) => this.removed.push(id),
  };

  statuses(id: TaskId): string[] {
    const out: string[] = [];
    for (const state of this.states)
      if (state.id === id && out[out.length - 1] !== state.status) out.push(state.status);
    return out;
  }

  until(id: TaskId, predicate: (state: TaskState) => boolean): Promise<TaskState> {
    const latest = this.states.findLast((state) => state.id === id);
    if (latest && predicate(latest)) return Promise.resolve(latest);
    const { promise, resolve } = Promise.withResolvers<TaskState>();
    this.#waiters.push({ predicate: (state) => state.id === id && predicate(state), resolve });
    return promise;
  }
}

interface Launch {
  sessionFile: string | null;
  fixture: string;
}

interface Harness {
  pool: TaskPool;
  events: Events;
  registry: TaskRegistry;
  projectId: ProjectId;
  /** 下一次 spawn 用的假 omp 参数：录制名和额外的命令行参数；按顺序消耗，用完回落到 `slash-status`。 */
  next: { fixture: string; flags?: string[]; env?: Record<string, string> }[];
  launches: Launch[];
}

const pools: TaskPool[] = [];
async function harness(
  options: { maxLive?: number; buildLaunchError?: Error; gate?: Promise<void> } = {},
): Promise<Harness> {
  const events = new Events();
  const registry = new TaskRegistry(path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json"));
  const next: Harness["next"] = [];
  const launches: Launch[] = [];
  const pool = new TaskPool({
    registry,
    getSettings: async () => settings(options.maxLive),
    events: events.sink,
    tsp: {
      buildLaunch: async (record, project) => {
        if (options.buildLaunchError) throw options.buildLaunchError;
        await options.gate;
        const spec = next.shift() ?? { fixture: "slash-status" };
        launches.push({ sessionFile: record.sessionFile, fixture: spec.fixture });
        return {
          command: process.execPath,
          args: [fakeTsp, spec.fixture, "--speed=100", ...(spec.flags ?? [])],
          cwd: project.path,
          env: { ...process.env, ...spec.env },
        };
      },
      session: {
        appVersion: "9.9.9",
        appearance: () => ({ dark: true, reduceMotion: false }),
        assignJob: () => () => undefined,
      },
    },
  });
  pools.push(pool);
  await pool.init();
  const project = await pool.ensureProject(projectDir);
  return { pool, events, registry, projectId: project.id, next, launches };
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

/** approval 录制里用户的两个操作：发的那句话、点 Approve。发出第一句话后任务进 needs_you（不可回收）。 */
function approvalSend(): { text: string; approve: TspEvent } {
  const [send, approve] = recordedUserEvents(loadTspFixture("approval")).map(
    (entry) => entry.event as unknown as TspEvent,
  );
  if (send?.ev !== "send" || !approve) throw new Error("unexpected approval fixture");
  return { text: send.text, approve };
}

describe("任务池：恢复历史会话", () => {
  it("以会话文件起进程（--resume）；已挂着该会话的任务不重复建；点开历史会话不算活动", async () => {
    const h = await harness();
    const sessionFile = path.join(scratch, "sessions", "旧 会话.jsonl");
    const sessionMtime = Date.UTC(2026, 9, 1);
    const state = await h.pool.resume({
      sessionFile,
      cwd: projectDir,
      projectId: h.projectId,
      title: "整理 日志",
      modifiedAt: sessionMtime,
    });
    await h.events.until(state.id, (s) => s.status === "idle");
    expect(h.launches).toEqual([{ sessionFile, fixture: "slash-status" }]);
    const again = await h.pool.resume({
      sessionFile,
      cwd: projectDir,
      projectId: h.projectId,
      title: null,
      modifiedAt: sessionMtime + 1,
    });
    expect(again.id).toBe(state.id);
    expect(h.pool.listTasks()).toHaveLength(1);
    // 时间是会话文件的修改时间：恢复、存会话文件、采用标题都不动它。
    expect(state.updatedAt).toBe(sessionMtime);
    expect(h.pool.listTasks()[0]?.updatedAt).toBe(sessionMtime);
    expect(h.registry.findTask(state.id)?.updatedAt).toBe(sessionMtime);
    expect(h.pool.listTasks()[0]?.title).toBe("整理 日志");
  }, 60_000);

  it("终端 omp 起的标题带私用区图标字形，存进任务时去掉", async () => {
    const h = await harness();
    const state = await h.pool.resume({
      sessionFile: path.join(scratch, "sessions", "带图标 会话.jsonl"),
      cwd: projectDir,
      projectId: h.projectId,
      title: "\uf0e7 CALC: Fix calc",
      modifiedAt: 1,
    });
    expect(h.registry.findTask(state.id)?.title).toBe("CALC: Fix calc");
    await h.events.until(state.id, (s) => s.status === "idle");
  }, 60_000);

  it("归档：关进程、从列表移除、tasks.json 保留记录；resume 同一会话文件把它恢复成未归档（同一 id）", async () => {
    const h = await harness();
    const sessionFile = path.join(scratch, "sessions", "归档.jsonl");
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.registry.updateTask(created.id, { sessionFile });
    await h.pool.archiveTask(created.id);
    expect(h.events.removed).toEqual([created.id]);
    expect(h.pool.listTasks()).toEqual([]);
    expect(h.registry.findTask(created.id)).toMatchObject({ archived: true, sessionFile });

    const back = await h.pool.resume({
      sessionFile,
      cwd: projectDir,
      projectId: h.projectId,
      title: null,
      modifiedAt: 1,
    });
    expect(back.id).toBe(created.id);
    expect(h.registry.findTask(created.id)?.archived).toBe(false);
    expect(h.pool.listTasks()).toHaveLength(1);
  }, 60_000);

  it("项目下还有未归档任务时不能移除项目，归档后可以", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await expect(h.pool.removeProject(h.projectId)).rejects.toThrow(/still has tasks/);
    await h.pool.archiveTask(created.id);
    await h.pool.removeProject(h.projectId);
    expect(h.pool.listProjects()).toEqual([]);
  }, 60_000);
});

describe("任务池：失败路径", () => {
  it("omp 意外退出：任务进 error（kind=exited）", async () => {
    const h = await harness();
    const pidFile = path.join(scratch, "crash.pid");
    h.next.push({ fixture: "slash-status", env: { FAKE_OMP_PID_FILE: pidFile } });
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    // 外部把 omp 杀掉（和 omp 崩溃一样：不是我们关的）。
    process.kill(Number((await readFile(pidFile, "utf8")).trim().split("\n")[0]));
    const failed = await h.events.until(created.id, (s) => s.status === "error");
    expect(failed.error?.kind).toBe("exited");
  }, 60_000);

  it("找不到可用的 omp：任务进 error，而不是卡在 starting", async () => {
    const h = await harness({ buildLaunchError: new Error("omp is not installed") });
    const created = await h.pool.createTask({ projectId: h.projectId });
    const failed = await h.events.until(created.id, (s) => s.status === "error");
    expect(failed.error).toMatchObject({ message: "omp is not installed" });
  }, 60_000);
});

describe("任务池：进程上限、回收", () => {
  it("到软上限时回收最久未用的可回收任务；正在前台的任务不会被回收", async () => {
    const h = await harness({ maxLive: 2 });
    const ids: TaskId[] = [];
    for (let i = 0; i < 3; i += 1) {
      const created = await h.pool.createTask({ projectId: h.projectId });
      await h.events.until(created.id, (s) => s.status === "idle");
      ids.push(created.id);
    }
    const [a, b, c] = ids as [TaskId, TaskId, TaskId];
    expect(h.events.statuses(a)).toEqual(["starting", "idle", "stopped"]);
    expect(h.pool.listTasks().find((s) => s.id === b)?.status).toBe("idle");
    expect(h.pool.listTasks().find((s) => s.id === c)?.status).toBe("idle");

    // b 在前台，d 启动时只能回收 c。
    await h.pool.openTask(b);
    const d = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(d.id, (s) => s.status === "idle");
    expect(h.pool.listTasks().find((s) => s.id === b)?.status).toBe("idle");
    expect(h.pool.listTasks().find((s) => s.id === c)?.status).toBe("stopped");
  }, 120_000);

  it("存活进程到硬上限（软上限 × 2）且没有可回收的任务时，新任务进 error(too_many_tasks)", async () => {
    const h = await harness({ maxLive: 1 });
    const { text } = approvalSend();
    // 两个任务都停在"等你确认"（needs_you 不可回收）。
    for (let i = 0; i < 2; i += 1) {
      h.next.push({ fixture: "approval" });
      const created = await h.pool.createTask({ projectId: h.projectId });
      await h.events.until(created.id, (s) => s.status === "idle");
      await h.pool.sendPrompt(created.id, { text, whenBusy: "steer" });
      await h.events.until(created.id, (s) => s.status === "needs_you");
    }
    const third = await h.pool.createTask({ projectId: h.projectId });
    const failed = await h.events.until(third.id, (s) => s.status === "error");
    expect(failed.error?.kind).toBe("too_many_tasks");
    expect(h.pool.listTasks().map((s) => s.status)).toEqual(["needs_you", "needs_you", "error"]);
  }, 120_000);

  it("可回收状态持续 15 分钟才关进程；没到点不关", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    const t0 = 1_000_000;
    await h.pool.sweep(t0);
    await h.pool.sweep(t0 + IDLE_RECYCLE_MS - 1);
    expect(h.pool.listTasks()[0]?.status).toBe("idle");
    await h.pool.sweep(t0 + IDLE_RECYCLE_MS);
    expect(h.pool.listTasks()[0]?.status).toBe("stopped");
  }, 60_000);

  it("shutdown 关掉所有进程，任务回到 stopped", async () => {
    const h = await harness();
    const one = await h.pool.createTask({ projectId: h.projectId });
    const two = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(one.id, (s) => s.status === "idle");
    await h.events.until(two.id, (s) => s.status === "idle");
    await h.pool.shutdown();
    expect(h.pool.listTasks().map((s) => s.status)).toEqual(["stopped", "stopped"]);
  }, 60_000);
});

/** 一个一启动就在 marker 文件里留痕的"omp"：用来断言有没有 spawn 过。 */
function markerCommand(name: string): { command: string; args: string[]; marker: string } {
  const marker = path.join(scratch, `${name}.spawned`);
  return {
    command: process.execPath,
    args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
    marker,
  };
}
const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

describe("任务池：启动过程中的归档和退出（不留孤儿进程、不推幽灵状态）", () => {
  async function pendingPool(gate: Promise<void>, spawned: { command: string; args: string[] }) {
    const events = new Events();
    const pool = new TaskPool({
      registry: new TaskRegistry(path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json")),
      getSettings: async () => settings(),
      events: events.sink,
      tsp: {
        buildLaunch: async (_record, project) => {
          await gate;
          return { command: spawned.command, args: spawned.args, cwd: project.path, env: process.env };
        },
        session: {
          appVersion: "9.9.9",
          appearance: () => ({ dark: true, reduceMotion: false }),
          assignJob: () => () => undefined,
        },
      },
    });
    pools.push(pool);
    await pool.init();
    const project = await pool.ensureProject(projectDir);
    return { pool, events, projectId: project.id };
  }

  it("buildLaunch 还在等（比如 omp 在下载）时归档：放行后不 spawn，归档之后没有任何 taskState 推送", async () => {
    const gate = Promise.withResolvers<void>();
    const spawned = markerCommand("archive-during-start");
    const { pool, events, projectId } = await pendingPool(gate.promise, spawned);
    const created = await pool.createTask({ projectId });
    const archived = pool.archiveTask(created.id);
    gate.resolve();
    await archived;
    const statesAtRemoval = events.states.length;
    expect(events.removed).toEqual([created.id]);
    expect(await exists(spawned.marker)).toBe(false);
    expect(events.states).toHaveLength(statesAtRemoval);
    expect(events.states.at(-1)?.status).not.toBe("idle");
    expect(pool.listTasks()).toEqual([]);
  }, 60_000);

  it("buildLaunch 还在等时应用退出：shutdown 等启动中止，不 spawn；任务是 stopped 而不是 error", async () => {
    const gate = Promise.withResolvers<void>();
    const spawned = markerCommand("shutdown-during-start");
    const { pool, events, projectId } = await pendingPool(gate.promise, spawned);
    const created = await pool.createTask({ projectId });
    const down = pool.shutdown();
    gate.resolve();
    await down;
    expect(await exists(spawned.marker)).toBe(false);
    expect(pool.listTasks()[0]?.status).toBe("stopped");
    expect(events.statuses(created.id)).not.toContain("error");
  }, 60_000);

  it("握手进行中归档：已 spawn 的进程被关掉，不进 error，也不再推状态", async () => {
    // 一个起来就不回 hello 的"omp"：握手卡住，进程活着。
    const pidFile = path.join(scratch, "stuck-handshake.pid");
    const stuck = {
      command: process.execPath,
      args: [
        "-e",
        `require("fs").appendFileSync(${JSON.stringify(pidFile)}, process.pid + "\\n"); setInterval(() => {}, 1000);`,
      ],
    };
    const { pool, events, projectId } = await pendingPool(Promise.resolve(), stuck);
    const created = await pool.createTask({ projectId });
    // 进程在另一个进程里写 pid 文件，只能轮询。
    const pid = await (async () => {
      for (let i = 0; i < 400; i += 1) {
        const text = await readFile(pidFile, "utf8").catch(() => "");
        if (text.trim() !== "") return Number(text.trim().split("\n")[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("the stuck omp never started");
    })();
    await pool.archiveTask(created.id);
    const after = events.states.length;
    expect(events.statuses(created.id)).not.toContain("error");
    expect(events.states).toHaveLength(after);
    // archiveTask 返回时进程树已经被结束；系统回收 pid 可能还要一小会儿。
    let alive = true;
    for (let i = 0; i < 80 && alive; i += 1) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  }, 60_000);
});

describe("任务池：已停止的任务", () => {
  it("没有进程时 stopTask 立刻返回空结果，不拉起 omp", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.shutdown();
    expect(h.pool.listTasks()[0]?.status).toBe("stopped");
    const launchesBefore = h.launches.length;
    const restored = await h.pool.stopTask(created.id);
    expect(restored).toMatchObject({ steering: [], followUp: [] });
    expect(h.launches).toHaveLength(launchesBefore);
    expect(h.pool.listTasks()[0]?.status).toBe("stopped");
  }, 60_000);
});
