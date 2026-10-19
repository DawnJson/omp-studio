// todo 进度（get_state.todoPhases → TaskState.todoPhases）和改名同步（set_session_name / session_info_update），
// 用 fake-omp 回放 simple-reply 的握手部分检查。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StudioSettings, TaskId, TaskState } from "../src/shared/ipc.ts";
import type { TodoPhase } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const source = path.join(root, "fixtures", "rpc", "simple-reply.ndjson");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio todo-"));
  projectDir = path.join(scratch, "项目");
  await mkdir(projectDir);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const phases: TodoPhase[] = [
  {
    name: "实现",
    tasks: [
      { content: "写代码", status: "completed" },
      { content: "跑测试", status: "in_progress" },
      { content: "发布", status: "blocked", blocker: "等审批" },
    ],
  },
];

type Entry = { kind: string; frame?: Record<string, unknown> };

/** simple-reply 的握手部分（到第一条 prompt 为止）+ 给定的后续帧 + hang；get_state 的应答带上 todoPhases。 */
async function fixtureFile(name: string, after: Entry[]): Promise<string> {
  const entries = (await readFile(source, "utf8"))
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Entry);
  const end = entries.findIndex((entry) => entry.kind === "in" && entry.frame?.type === "prompt");
  const head = entries.slice(0, end + 1).map((entry) => {
    if (entry.kind === "out" && entry.frame?.command === "get_state")
      return { ...entry, frame: { ...entry.frame, data: { ...(entry.frame.data as object), todoPhases: phases } } };
    return entry;
  });
  const file = path.join(scratch, `${name}.ndjson`);
  await writeFile(file, [...head, ...after, { kind: "hang" }].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return file;
}

const settings: StudioSettings = {
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses: 6,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  yoloConfirmed: false,
};

const pools: TaskPool[] = [];
async function start(fixture: string, inputLog: string, tasksFile?: string) {
  const states: TaskState[] = [];
  const waiters: { predicate: (s: TaskState) => boolean; resolve: (s: TaskState) => void }[] = [];
  const file = tasksFile ?? path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json");
  const registry = new TaskRegistry(file);
  const pool = new TaskPool({
    registry,
    getSettings: async () => settings,
    buildLaunch: async (_record, project) => ({
      command: process.execPath,
      args: [fakeOmp, fixture, inputLog],
      cwd: project.path,
      env: process.env,
    }),
    assignJob: () => {},
    events: {
      state: (state: TaskState) => {
        states.push(state);
        for (const waiter of waiters.splice(0)) {
          if (waiter.predicate(state)) waiter.resolve(state);
          else waiters.push(waiter);
        }
      },
      transcript: () => {},
      notice: () => {},
      taskRemoved: () => {},
      slashCommands: () => {},
      subagents: () => {},
    },
  });
  pools.push(pool);
  await pool.init();
  const project = await pool.ensureProject(projectDir);
  const until = (id: TaskId, predicate: (s: TaskState) => boolean): Promise<TaskState> => {
    const latest = states.findLast((s) => s.id === id);
    if (latest && predicate(latest)) return Promise.resolve(latest);
    const { promise, resolve } = Promise.withResolvers<TaskState>();
    waiters.push({ predicate: (s) => s.id === id && predicate(s), resolve });
    return promise;
  };
  return { pool, project, until, registry, tasksFile: file, states };
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

const sent = async (log: string): Promise<Record<string, unknown>[]> =>
  (await readFile(log, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("todo 进度", () => {
  it("握手时 get_state.todoPhases 进入 TaskState", async () => {
    const h = await start(await fixtureFile("todo", []), path.join(scratch, "todo-in.log"));
    const created = await h.pool.createTask({ projectId: h.project.id });
    const idle = await h.until(created.id, (s) => s.status === "idle");
    expect(idle.todoPhases).toEqual(phases);
    expect(created.todoPhases).toEqual([]);
  });
});

describe("改名同步", () => {
  it("renameTask：保存标题，并给运行中的 omp 发 set_session_name", async () => {
    const log = path.join(scratch, "rename-in.log");
    const h = await start(await fixtureFile("rename", []), log);
    const created = await h.pool.createTask({ projectId: h.project.id });
    await h.until(created.id, (s) => s.status === "idle");
    await h.pool.renameTask(created.id, "新名字");
    const state = await h.until(created.id, (s) => s.title === "新名字");
    expect(state.title).toBe("新名字");
    expect((await sent(log)).filter((frame) => frame.type === "set_session_name")).toMatchObject([{ name: "新名字" }]);
  });

  it("session_info_update（/rename 或 omp 自己改的名）更新任务标题；空标题忽略", async () => {
    const h = await start(
      await fixtureFile("info", [
        { kind: "out", frame: { type: "session_info_update", sessionId: "s1" } },
        { kind: "out", frame: { type: "session_info_update", sessionId: "s1", title: "  " } },
        { kind: "out", frame: { type: "session_info_update", sessionId: "s1", title: "omp 起的名" } },
      ]),
      path.join(scratch, "info-in.log"),
    );
    const created = await h.pool.createTask({ projectId: h.project.id });
    await h.until(created.id, (s) => s.status === "idle");
    // fake-omp 在收到 prompt 之后才发这些帧；prompt 的应答录制里没有，不等它。
    void h.pool.sendPrompt(created.id, { text: "hi", whenBusy: "steer" }).catch(() => {});
    const state = await h.until(created.id, (s) => s.title === "omp 起的名");
    expect(state.title).toBe("omp 起的名");
  });

  it("连续改名 甲→乙 后晚到的 甲 的回声不会把标题改回去", async () => {
    const h = await start(
      await fixtureFile("echo", [
        { kind: "out", frame: { type: "session_info_update", sessionId: "s1", title: "甲" } },
        { kind: "out", frame: { type: "session_info_update", sessionId: "s1", title: "乙" } },
        { kind: "out", frame: { type: "session_info_update", sessionId: "s1", title: "哨兵" } },
      ]),
      path.join(scratch, "echo-in.log"),
    );
    const created = await h.pool.createTask({ projectId: h.project.id });
    await h.until(created.id, (s) => s.status === "idle");
    await h.pool.renameTask(created.id, "甲");
    await h.pool.renameTask(created.id, "乙");
    const mark = h.states.length;
    void h.pool.sendPrompt(created.id, { text: "hi", whenBusy: "steer" }).catch(() => {});
    // 哨兵是最后一帧：它生效时，前面的回声都已处理过。
    await h.until(created.id, (s) => s.title === "哨兵");
    expect(h.states.slice(mark).filter((s) => s.id === created.id && s.title === "甲")).toEqual([]);
  });

  it("没有进程时改的名字，下次启动握手后补发 set_session_name", async () => {
    const log = path.join(scratch, "pending-in.log");
    const file = await fixtureFile("pending", []);
    const first = await start(file, log);
    const created = await first.pool.createTask({ projectId: first.project.id });
    await first.until(created.id, (s) => s.status === "idle");
    await first.registry.save();
    await first.pool.shutdown();

    // 重开应用：任务是 stopped，没有进程。
    const second = await start(file, log, first.tasksFile);
    expect(second.pool.listTasks()).toMatchObject([{ id: created.id, status: "stopped" }]);
    await second.pool.renameTask(created.id, "停着改的名");
    expect(second.pool.listTasks()[0]?.title).toBe("停着改的名");
    expect((await sent(log)).filter((frame) => frame.type === "set_session_name")).toEqual([]);

    void second.pool.sendPrompt(created.id, { text: "hi", whenBusy: "steer" }).catch(() => {});
    await second.until(created.id, (s) => s.status === "idle" || s.status === "running");
    await expect
      .poll(async () => (await sent(log)).filter((frame) => frame.type === "set_session_name"))
      .toMatchObject([{ name: "停着改的名" }]);
  });
});
