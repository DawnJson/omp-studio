// 任务池：进程上限、回收、归档、恢复历史会话、失败路径、启动过程中的归档和退出。
// 进程是 test/fake-omp/fake-tsp-omp.ts（伪终端里回放 fixtures/tsp 的录制）；任务状态推导和 omp 交互见 test/task-tsp.test.ts。
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IdleClose, ProjectId, StudioSettings, TaskId, TaskState } from "../src/shared/ipc.ts";
import type { TspEvent } from "../src/shared/tsp/tsp.generated.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry, type TaskRecord } from "../src/main/tasks/task-registry.ts";
import { log } from "../src/main/log/log.ts";
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

const settings = (maxLiveProcesses = 6, idleClose: IdleClose = "1h"): StudioSettings => ({
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses,
  idleClose,
  reduceMotion: false,
  enterWhileRunning: "steer",
  soundOnDone: false,
  copyOnSelect: true,
  toolHeadsOnly: false,
  groupToolCalls: true,
  terminalShell: null,
  fontSize: 15,
  yoloConfirmed: false,
  petEnabled: false,
  petTalk: false,
  backdrop: "theme",
  backdropStrength: "medium",
  customBackdrop: null,
  glass: false,
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
  /** 删除会话时临时起的 omp（不是任务）：它们 `--resume` 的会话文件。 */
  temporaryLaunches: (string | null)[];
  tasksFile: string;
}

const SEED_PROJECT = "p-seed" as ProjectId;

const pools: TaskPool[] = [];
async function harness(
  options: {
    maxLive?: number;
    idleClose?: IdleClose;
    buildLaunchError?: Error;
    gate?: Promise<void>;
    /** 启动前写进 tasks.json 的任务记录（项目是 projectDir，id SEED_PROJECT）。 */
    seed?: Partial<TaskRecord>[];
    sessionInUse?: (sessionFile: string) => Promise<boolean>;
    waitBeforeRecheck?: () => Promise<void>;
  } = {},
): Promise<Harness> {
  const events = new Events();
  const tasksFile = path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json");
  if (options.seed) {
    const tasks = options.seed.map((patch, index) => ({
      id: `seed-${index}`,
      projectId: SEED_PROJECT,
      sessionFile: null,
      title: `任务 ${index}`,
      createdAt: 1,
      updatedAt: 1,
      archived: false,
      model: null,
      thinkingLevel: null,
      worktreePath: null,
      worktreeBranch: null,
      worktreeBase: null,
      ...patch,
    }));
    const projects = [{ id: SEED_PROJECT, path: projectDir, name: "项目 一", hidden: false }];
    await writeFile(tasksFile, JSON.stringify({ version: 1, projects, tasks }), "utf8");
  }
  const registry = new TaskRegistry(tasksFile);
  const next: Harness["next"] = [];
  const launches: Launch[] = [];
  const temporaryLaunches: (string | null)[] = [];
  const pool = new TaskPool({
    registry,
    getSettings: async () => settings(options.maxLive, options.idleClose),
    events: events.sink,
    ...(options.sessionInUse && { sessionInUse: options.sessionInUse }),
    ...(options.waitBeforeRecheck && { waitBeforeRecheck: options.waitBeforeRecheck }),
    tsp: {
      buildLaunch: async (record, project, launchOptions) => {
        if (options.buildLaunchError) throw options.buildLaunchError;
        await options.gate;
        const spec = next.shift() ?? { fixture: "slash-status" };
        if (launchOptions?.temporary) temporaryLaunches.push(record.sessionFile);
        else launches.push({ sessionFile: record.sessionFile, fixture: spec.fixture });
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
  return { pool, events, registry, projectId: project.id, next, launches, temporaryLaunches, tasksFile };
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
  // 恢复前 studio 会确认会话文件还在（不在就是 session_missing，不起 omp）。
  beforeAll(async () => {
    await mkdir(path.join(scratch, "sessions"), { recursive: true });
    for (const name of ["旧 会话.jsonl", "带图标 会话.jsonl"])
      await writeFile(path.join(scratch, "sessions", name), "{}\n");
  });

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

  it("归档：关进程、从列表移除、tasks.json 保留记录、会话标成已归档；resume 同一会话文件把它恢复成未归档（同一 id）", async () => {
    const h = await harness();
    const sessionFile = path.join(scratch, "sessions", "归档.jsonl");
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.registry.updateTask(created.id, { sessionFile });
    const linked = () => h.pool.listSessionLinks().map((link) => [link.sessionFile, link.archived]);
    expect(linked()).toEqual([[sessionFile, false]]);
    await h.pool.archiveTask(created.id);
    expect(h.events.removed).toEqual([created.id]);
    expect(h.pool.listTasks()).toEqual([]);
    expect(h.registry.findTask(created.id)).toMatchObject({ archived: true, sessionFile });
    // 已归档任务的会话标成 archived：不在列表里，只在"已归档"里，点开才找得回来（issue #8、#9）。
    expect(linked()).toEqual([[sessionFile, true]]);

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
    expect(linked()).toEqual([[sessionFile, false]]);
  }, 60_000);

  it("归档还没挂在任务上的历史会话：建一条已归档记录、不起 omp；resume 把它恢复成任务", async () => {
    const h = await harness();
    const sessionFile = path.join(scratch, "sessions", "终端里开的.jsonl");
    await h.pool.archiveSession({ sessionFile, cwd: projectDir, title: "终端会话", modifiedAt: 7 });
    expect(h.pool.listTasks()).toEqual([]);
    expect(h.pool.listSessionLinks()).toEqual([expect.objectContaining({ sessionFile, archived: true })]);
    const back = await h.pool.resume({
      sessionFile,
      cwd: projectDir,
      projectId: h.projectId,
      title: null,
      modifiedAt: 7,
    });
    expect(h.registry.findTask(back.id)).toMatchObject({ archived: false, title: "终端会话", sessionFile });
    expect(h.pool.listTasks().map((task) => task.id)).toEqual([back.id]);
  }, 60_000);

  it("从列表移除只把项目藏起来：任务不归档、照常运行；在这个项目里新建任务或再打开这个文件夹时重新显示", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.removeProject(h.projectId);
    expect(h.pool.listProjects()).toEqual([expect.objectContaining({ id: h.projectId, hidden: true })]);
    expect(h.registry.findTask(created.id)?.archived).toBe(false);
    expect(h.pool.listTasks().map((task) => [task.id, task.status])).toEqual([[created.id, "idle"]]);

    const second = await h.pool.createTask({ projectId: h.projectId });
    expect(h.pool.listProjects()[0]?.hidden).toBe(false);
    await h.events.until(second.id, (s) => s.status === "idle");

    await h.pool.removeProject(h.projectId);
    expect((await h.pool.ensureProject(projectDir)).id).toBe(h.projectId);
    expect(h.pool.listProjects()[0]?.hidden).toBe(false);
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

  it("保持运行的任务到软上限时不被回收，换成回收下一个最久未用的", async () => {
    const h = await harness({ maxLive: 2 });
    const a = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(a.id, (s) => s.status === "idle");
    await h.pool.setTaskKeepAlive(a.id, true);
    const b = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(b.id, (s) => s.status === "idle");
    const c = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(c.id, (s) => s.status === "idle");
    expect(h.pool.listTasks().find((s) => s.id === a.id)?.status).toBe("idle");
    expect(h.pool.listTasks().find((s) => s.id === b.id)?.status).toBe("stopped");
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

  it("可回收状态持续到设置的时长（默认 1 小时）才关进程；没到点不关", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    const t0 = 1_000_000;
    await h.pool.sweep(t0);
    await h.pool.sweep(t0 + 60 * 60_000 - 1);
    expect(h.pool.listTasks()[0]?.status).toBe("idle");
    await h.pool.sweep(t0 + 60 * 60_000);
    expect(h.pool.listTasks()[0]?.status).toBe("stopped");
  }, 60_000);

  it("设成「从不」时空闲多久都不关", async () => {
    const h = await harness({ idleClose: "never" });
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sweep(1_000_000);
    await h.pool.sweep(1_000_000 + 30 * 24 * 60 * 60_000);
    expect(h.pool.listTasks()[0]?.status).toBe("idle");
  }, 60_000);

  it("保持运行：定时回收不关它，记进任务记录；取消后从那一刻重新计时", async () => {
    const h = await harness({ idleClose: "15m" });
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.setTaskKeepAlive(created.id, true);
    expect(h.pool.listTasks()[0]?.keepAlive).toBe(true);
    expect(h.registry.findTask(created.id)?.keepAlive).toBe(true);
    const t0 = 1_000_000;
    await h.pool.sweep(t0);
    await h.pool.sweep(t0 + 24 * 60 * 60_000);
    expect(h.pool.listTasks()[0]?.status).toBe("idle");

    await h.pool.setTaskKeepAlive(created.id, false);
    const t1 = t0 + 25 * 60 * 60_000;
    await h.pool.sweep(t1);
    await h.pool.sweep(t1 + 15 * 60_000 - 1);
    expect(h.pool.listTasks()[0]?.status).toBe("idle");
    await h.pool.sweep(t1 + 15 * 60_000);
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

describe("任务池：会话文件在 omp 里被删了（issue #10 对账）", () => {
  const sessionsDir = () => path.join(scratch, "对账 会话");
  async function sessionFile(name: string): Promise<string> {
    await mkdir(sessionsDir(), { recursive: true });
    const file = path.join(sessionsDir(), name);
    await writeFile(file, "{}\n");
    return file;
  }
  const missing = (name: string) => path.join(sessionsDir(), "不存在", name);

  it("没归档、没有进程、文件确实不在（ENOENT / ENOTDIR）的任务记录被去掉，推 taskRemoved；在的、已归档的不动", async () => {
    const kept = await sessionFile("还在.jsonl");
    const notDir = path.join(kept, "下面.jsonl");
    const h = await harness({
      seed: [
        { sessionFile: missing("没了.jsonl") },
        { sessionFile: notDir },
        { sessionFile: kept },
        { sessionFile: missing("归档的.jsonl"), archived: true },
      ],
      waitBeforeRecheck: async () => {},
    });
    expect(await h.pool.pruneMissingSessions()).toEqual(["seed-0", "seed-1"]);
    expect(h.events.removed).toEqual(["seed-0", "seed-1"]);
    expect(h.pool.listTasks().map((task) => task.id)).toEqual(["seed-2"]);
    expect(h.registry.listTasks().map((task) => task.id)).toEqual(["seed-2", "seed-3"]);
    // 落盘了：重新载入也没有。
    await h.registry.flushed();
    const reloaded = new TaskRegistry(h.tasksFile);
    await reloaded.load();
    expect(reloaded.listTasks().map((task) => task.id)).toEqual(["seed-2", "seed-3"]);
  });

  it("stat 报的不是“不在”（这里是非法路径）、没有会话文件、有 worktree 的任务不动", async () => {
    const h = await harness({
      seed: [
        { sessionFile: path.join(sessionsDir(), "坏\u0000路径.jsonl") },
        { sessionFile: null },
        {
          sessionFile: missing("工作区.jsonl"),
          worktreePath: projectDir,
          worktreeBranch: "studio/x",
          worktreeBase: "main",
        },
      ],
    });
    expect(await h.pool.pruneMissingSessions()).toEqual([]);
    expect(h.events.removed).toEqual([]);
    expect(h.registry.listTasks()).toHaveLength(3);
  });

  it("第一次看不在、隔一会儿再看又在了（omp 原子重写会话文件时短暂不在原处）：不动", async () => {
    const file = missing("短暂.jsonl");
    const h = await harness({
      seed: [{ sessionFile: file }],
      waitBeforeRecheck: async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, "{}\n");
      },
    });
    expect(await h.pool.pruneMissingSessions()).toEqual([]);
    expect(h.registry.listTasks()).toHaveLength(1);
    await rm(path.dirname(file), { recursive: true, force: true });
  });

  it("有进程的任务、前台任务不动", async () => {
    const h = await harness({ seed: [{ sessionFile: missing("前台.jsonl") }] });
    // 前台：打开它（文件不在，报 session_missing，不起进程），还是选中的任务。
    await h.pool.openTask("seed-0" as TaskId);
    await h.events.until("seed-0" as TaskId, (state) => state.error?.kind === "session_missing");
    // 有进程：新建的任务跑起来之后，记录里的会话文件被指到一个不在的路径。
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.registry.updateTask(created.id, { sessionFile: missing("在跑.jsonl") });
    expect(await h.pool.pruneMissingSessions()).toEqual([]);
    expect(h.events.removed).toEqual([]);
  }, 60_000);
});

describe("任务池：删除会话（经 omp 的 /delete，issue #10）", () => {
  const sessionsDir = () => path.join(scratch, "删除 会话");
  async function sessionFile(name: string): Promise<string> {
    await mkdir(sessionsDir(), { recursive: true });
    const file = path.join(sessionsDir(), name);
    await writeFile(file, "{}\n");
    return file;
  }
  const exists = (file: string) =>
    access(file).then(
      () => true,
      () => false,
    );

  it("有进程的任务：在它自己的 omp 里发 /delete，文件没了才去掉任务记录，不另起进程", async () => {
    const file = await sessionFile("在跑.jsonl");
    const h = await harness();
    h.next.push({ fixture: "slash-status", env: { FAKE_TSP_SESSION_FILE: file, FAKE_TSP_DELETE_FILE: file } });
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(
      created.id,
      (state) => state.status === "idle" && h.registry.findTask(created.id)?.sessionFile === file,
    );
    await h.pool.deleteTask(created.id);
    expect(await exists(file)).toBe(false);
    expect(h.registry.findTask(created.id)).toBeUndefined();
    expect(h.events.removed).toEqual([created.id]);
    expect(h.pool.listTasks()).toEqual([]);
    expect(h.temporaryLaunches).toEqual([]);
  }, 60_000);

  it("没有进程的任务（含已归档的）：起一个临时 omp 删，临时进程不推状态；删完去掉记录", async () => {
    const idle = await sessionFile("没在跑.jsonl");
    const archived = await sessionFile("归档.jsonl");
    const h = await harness({ seed: [{ sessionFile: idle }, { sessionFile: archived, archived: true }] });
    h.next.push({ fixture: "slash-status", env: { FAKE_TSP_DELETE_FILE: idle } });
    await h.pool.deleteTask("seed-0" as TaskId);
    h.next.push({ fixture: "slash-status", env: { FAKE_TSP_DELETE_FILE: archived } });
    await h.pool.deleteSession({ sessionFile: archived, cwd: projectDir });
    expect([await exists(idle), await exists(archived)]).toEqual([false, false]);
    expect(h.temporaryLaunches).toEqual([idle, archived]);
    expect(h.launches).toEqual([]);
    expect(h.registry.listTasks()).toEqual([]);
    expect(h.events.removed).toEqual(["seed-0", "seed-1"]);
    expect(h.events.states.filter((state) => state.id !== ("seed-0" as TaskId))).toEqual([]);
  }, 60_000);

  it("没挂在任务上的会话（终端里开的）：临时 omp 删掉文件，不建任务记录", async () => {
    const file = await sessionFile("终端.jsonl");
    const h = await harness();
    h.next.push({ fixture: "slash-status", env: { FAKE_TSP_DELETE_FILE: file } });
    await h.pool.deleteSession({ sessionFile: file, cwd: projectDir });
    expect(await exists(file)).toBe(false);
    expect(h.registry.listTasks()).toEqual([]);
    expect(h.events.removed).toEqual([]);
  }, 60_000);

  it("别的 omp 正开着这个会话（omp session lease）：拒绝，不起进程，文件和记录都不动", async () => {
    const file = await sessionFile("被占着.jsonl");
    const asked: string[] = [];
    const h = await harness({
      seed: [{ sessionFile: file }],
      sessionInUse: async (sessionFile) => {
        asked.push(sessionFile);
        return true;
      },
    });
    await expect(h.pool.deleteTask("seed-0" as TaskId)).rejects.toThrow("the session is open in another omp process");
    expect(asked).toEqual([file]);
    expect(h.temporaryLaunches).toEqual([]);
    expect(await exists(file)).toBe(true);
    expect(h.registry.findTask("seed-0" as TaskId)).toBeDefined();
    expect(h.events.removed).toEqual([]);
  });

  it("删到一半退出应用：shutdown 连临时 omp 一起关，删除以失败结束", async () => {
    const file = await sessionFile("退出时.jsonl");
    const pidFile = path.join(scratch, "delete-shutdown.pid");
    const h = await harness();
    // 不给 FAKE_TSP_DELETE_FILE：假 omp 收到 /delete 不删文件，删除一直轮询到 shutdown（上限 10 秒）。
    h.next.push({ fixture: "slash-status", env: { FAKE_OMP_PID_FILE: pidFile } });
    const settled = h.pool.deleteSession({ sessionFile: file, cwd: projectDir }).then(
      () => null,
      (error: unknown) => error,
    );
    await expect.poll(() => exists(pidFile), { timeout: 30_000 }).toBe(true);
    const pid = Number((await readFile(pidFile, "utf8")).trim().split("\n")[0]);
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    await h.pool.shutdown();
    // 等的时间远小于删除的 10 秒上限：shutdown 不关临时进程的话，它这时还活着。
    await expect.poll(alive, { timeout: 2_000 }).toBe(false);
    expect(await settled).toBeInstanceOf(Error);
    expect(await exists(file)).toBe(true);
    expect(h.temporaryLaunches).toEqual([file]);
  }, 60_000);

  it("会话文件已经不在：不起 omp，直接去掉记录", async () => {
    const h = await harness({ seed: [{ sessionFile: path.join(sessionsDir(), "早没了.jsonl") }] });
    await h.pool.deleteTask("seed-0" as TaskId);
    expect(h.temporaryLaunches).toEqual([]);
    expect(h.registry.listTasks()).toEqual([]);
    expect(h.events.removed).toEqual(["seed-0"]);
  });
});

describe("任务池：关闭会话（issue #11）", () => {
  const sessionsDir = () => path.join(scratch, "关闭 会话");
  async function sessionFile(name: string): Promise<string> {
    await mkdir(sessionsDir(), { recursive: true });
    const file = path.join(sessionsDir(), name);
    await writeFile(file, "{}\n");
    return file;
  }
  async function exited(pid: number): Promise<boolean> {
    for (let i = 0; i < 80; i += 1) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        return true;
      }
    }
    return false;
  }

  it("空闲的前台任务：进程退出，任务和对话快照留着（stopped）；再打开时 --resume 同一个会话文件", async () => {
    const file = await sessionFile("空闲.jsonl");
    const pidFile = path.join(scratch, "close-idle.pid");
    const h = await harness({ seed: [{ sessionFile: file }] });
    const id = "seed-0" as TaskId;
    h.next.push({ fixture: "slash-status", env: { FAKE_OMP_PID_FILE: pidFile } });
    await h.pool.openTask(id);
    await h.events.until(id, (s) => s.status === "idle");
    const pid = Number((await readFile(pidFile, "utf8")).trim().split("\n")[0]);

    await h.pool.closeTask(id);
    expect(h.pool.listTasks().map((s) => [s.id, s.status])).toEqual([[id, "stopped"]]);
    expect(await exited(pid)).toBe(true);
    expect(h.registry.findTask(id)).toMatchObject({ sessionFile: file, archived: false });
    expect(h.events.removed).toEqual([]);
    // 快照还是退出前那份：对话照常显示。
    expect(h.pool.getTspSnapshot(id).document.surfaces.length).toBeGreaterThan(0);
    // 没有进程时再关什么也不做。
    await h.pool.closeTask(id);

    await h.pool.openTask(id);
    await h.events.until(id, (s) => s.status === "idle");
    expect(h.launches.map((launch) => launch.sessionFile)).toEqual([file, file]);
  }, 60_000);

  it("发消息会把关掉的任务重新拉起来", async () => {
    const file = await sessionFile("发消息.jsonl");
    const h = await harness({ seed: [{ sessionFile: file }] });
    const id = "seed-0" as TaskId;
    await h.pool.openTask(id);
    await h.events.until(id, (s) => s.status === "idle");
    await h.pool.closeTask(id);
    expect(h.pool.listTasks()[0]?.status).toBe("stopped");
    await h.pool.sendPrompt(id, { text: "/status", whenBusy: "steer" });
    expect(h.launches.map((launch) => launch.sessionFile)).toEqual([file, file]);
    expect(h.pool.listTasks()[0]?.status).not.toBe("stopped");
  }, 60_000);

  it("忙（在等你确认）的任务拒绝关闭，进程照常", async () => {
    const h = await harness();
    const { text } = approvalSend();
    h.next.push({ fixture: "approval" });
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, { text, whenBusy: "steer" });
    await h.events.until(created.id, (s) => s.status === "needs_you");
    await expect(h.pool.closeTask(created.id)).rejects.toThrow("the task is busy");
    expect(h.pool.listTasks()[0]?.status).toBe("needs_you");
  }, 60_000);
});

describe("任务池：恢复前看会话租约（issue #11）", () => {
  const sessionsDir = () => path.join(scratch, "租约 会话");
  async function sessionFile(name: string): Promise<string> {
    await mkdir(sessionsDir(), { recursive: true });
    const file = path.join(sessionsDir(), name);
    await writeFile(file, "{}\n");
    return file;
  }

  it("别的 omp 占着会话：报 session_in_use，不起进程；那边退出后再打开照常 --resume", async () => {
    const file = await sessionFile("被占着.jsonl");
    let held = true;
    const asked: string[] = [];
    const h = await harness({
      seed: [{ sessionFile: file }],
      sessionInUse: async (sessionFile) => {
        asked.push(sessionFile);
        return held;
      },
    });
    const id = "seed-0" as TaskId;
    await h.pool.openTask(id);
    const failed = await h.events.until(id, (s) => s.status === "error");
    expect(failed.error?.kind).toBe("session_in_use");
    expect(h.launches).toEqual([]);
    expect(asked).toEqual([file]);
    // 发消息也一样不起进程，错误照抛。
    await expect(h.pool.sendPrompt(id, { text: "hi", whenBusy: "steer" })).rejects.toThrow(
      "held by another omp process",
    );
    expect(h.launches).toEqual([]);

    held = false;
    await h.pool.openTask(id);
    await h.events.until(id, (s) => s.status === "idle");
    expect(h.launches.map((launch) => launch.sessionFile)).toEqual([file]);
  }, 60_000);

  it("检查本身失败（老版本 omp、超时）：照常起", async () => {
    const file = await sessionFile("查不了.jsonl");
    const h = await harness({
      seed: [{ sessionFile: file }],
      sessionInUse: async () => {
        throw new Error("omp session lease exited with code 1");
      },
    });
    await h.pool.openTask("seed-0" as TaskId);
    await h.events.until("seed-0" as TaskId, (s) => s.status === "idle");
    expect(h.launches.map((launch) => launch.sessionFile)).toEqual([file]);
  }, 60_000);

  it("还没有会话文件的新任务不问", async () => {
    const asked: string[] = [];
    const h = await harness({
      sessionInUse: async (sessionFile) => {
        asked.push(sessionFile);
        return true;
      },
    });
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    expect(asked).toEqual([]);
  }, 60_000);
});

describe("任务池：一个会话文件只对应一个任务（issue #11）", () => {
  it("omp 报的会话文件已挂在别的任务上：这个任务的记录不改，不出现两个任务挂同一个文件", async () => {
    const dir = path.join(scratch, "唯一 会话");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "已有主.jsonl");
    await writeFile(file, "{}\n");
    const h = await harness({ seed: [{ sessionFile: file }] });
    h.next.push({ fixture: "slash-status", env: { FAKE_TSP_SESSION_FILE: file } });
    const created = await h.pool.createTask({ projectId: h.projectId });
    // omp 一报会话文件，任务就试着存它（TspRunner.#persistSessionFile）：等到存成了或者记下"挂在别的任务上"。
    const warn = vi.spyOn(log, "warn");
    const settled = () =>
      h.registry.findTask(created.id)?.sessionFile === file ||
      warn.mock.calls.some(([message]) => message.includes("omp switched to a session that belongs to another task"));
    await vi.waitFor(() => expect(settled()).toBe(true), { timeout: 30_000 });
    warn.mockRestore();
    expect(h.registry.findTask(created.id)?.sessionFile).toBeNull();
    expect(h.registry.findTask("seed-0" as TaskId)?.sessionFile).toBe(file);
  }, 60_000);
});
