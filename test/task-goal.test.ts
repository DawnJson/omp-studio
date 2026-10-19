// 目标模式（/goal）：goal_updated → TaskState.goal；get_state.goal 在握手时被采用；taskGoal 经 RPC goal 发给 omp。
// 语义出自真实 omp 18.12.2 的实测（goal.continuationModes 含 "rpc" 时 create 会自己起轮次；用量每 1–2 秒推一次 goal_updated；
// complete / dropped 各来一次 goal_updated 后 get_state.goal 为 null；abort 把目标暂停）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StudioSettings, TaskGoal, TaskId, TaskState } from "../src/shared/ipc.ts";
import type { Goal, GoalModeState } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { sameGoal, toTaskGoal } from "../src/main/tasks/goal-state.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio goal-"));
  projectDir = path.join(scratch, "项目");
  await mkdir(projectDir);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const settings: StudioSettings = {
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses: 6,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  yoloConfirmed: false,
};

const goal = (extra: Partial<Goal> = {}): Goal => ({
  id: "g1",
  objective: "写 hello.txt",
  status: "active",
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});
const modeState = (g: Goal, extra: Partial<GoalModeState> = {}): GoalModeState => ({
  enabled: g.status === "active" || g.status === "budget-limited",
  mode: "active",
  goal: g,
  ...extra,
});

type Entry = Record<string, unknown>;
interface RecordedLine extends Entry {
  kind?: string;
  frame?: { type?: string; command?: string; data?: Record<string, unknown> };
}

/** 握手部分取 simple-reply 录制里 prompt 之前的条目（可把 get_state 应答里的 goal 换掉），后面接这条测试自己的往返。 */
async function fixtureWith(tail: Entry[], handshakeGoal?: GoalModeState): Promise<string> {
  const lines = (await readFile(path.join(root, "fixtures", "rpc", "simple-reply.ndjson"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line): RecordedLine => JSON.parse(line));
  const promptAt = lines.findIndex((entry) => entry.frame?.type === "prompt");
  const head = lines.slice(0, promptAt).map((entry): RecordedLine => {
    if (
      handshakeGoal &&
      entry.kind === "out" &&
      entry.frame?.type === "response" &&
      entry.frame.command === "get_state"
    )
      return { ...entry, frame: { ...entry.frame, data: { ...entry.frame.data, goal: handshakeGoal } } };
    return entry;
  });
  const file = path.join(await mkdtemp(path.join(scratch, "fx-")), "goal.ndjson");
  await writeFile(file, [...head, ...tail, { kind: "hang" }].map((entry) => JSON.stringify(entry)).join("\n"));
  return file;
}

const response = (id: string, extra: Entry): Entry => ({
  kind: "out",
  frame: { id, type: "response", command: "goal", ...extra },
});
const goalOk = (id: string, g: Goal | null): Entry =>
  response(id, { success: true, data: { goal: g, state: g ? modeState(g) : null } });
const goalEvent = (g: Goal | null, state?: GoalModeState): Entry => ({
  kind: "out",
  frame: { type: "goal_updated", goal: g, ...(state && { state }) },
});

const pools: TaskPool[] = [];
async function start(fixture: string) {
  const inputLog = path.join(path.dirname(fixture), "input.log");
  const states: TaskState[] = [];
  const pool = new TaskPool({
    registry: new TaskRegistry(path.join(path.dirname(fixture), "tasks.json")),
    getSettings: async () => settings,
    buildLaunch: async (_record, project) => ({
      command: process.execPath,
      args: [fakeOmp, fixture, inputLog],
      cwd: project.path,
      env: process.env,
    }),
    assignJob: () => {},
    events: {
      state: (state) => states.push(state),
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
  const created = await pool.createTask({ projectId: project.id });
  const latest = (id: TaskId): TaskState | undefined => states.findLast((s) => s.id === id);
  await vi.waitFor(() => expect(latest(created.id)?.status).toBe("idle"), { timeout: 15_000 });
  return { pool, id: created.id, inputLog, latest, states };
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

const sentGoalOps = async (inputLog: string): Promise<Entry[]> =>
  (await readFile(inputLog, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line): Entry => JSON.parse(line))
    .filter((frame) => frame["type"] === "goal")
    .map(({ id: _id, ...rest }) => rest);

describe("toTaskGoal / sameGoal（纯函数）", () => {
  it("active / paused / budget-limited 保留，complete / dropped / 没有目标都是 null；没有预算是 null", () => {
    expect(toTaskGoal(goal())).toEqual<TaskGoal>({
      id: "g1",
      objective: "写 hello.txt",
      status: "active",
      tokensUsed: 0,
      tokenBudget: null,
      timeUsedSeconds: 0,
    });
    expect(toTaskGoal(goal({ status: "paused", tokenBudget: 500 }))).toMatchObject({
      status: "paused",
      tokenBudget: 500,
    });
    expect(toTaskGoal(goal({ status: "budget-limited" }))?.status).toBe("budget-limited");
    expect(toTaskGoal(goal({ status: "complete" }))).toBeNull();
    expect(toTaskGoal(goal({ status: "dropped" }))).toBeNull();
    expect(toTaskGoal(null)).toBeNull();
    expect(toTaskGoal(undefined)).toBeNull();
  });

  it("sameGoal 比较全部显示字段", () => {
    const a = toTaskGoal(goal());
    expect(sameGoal(a, toTaskGoal(goal()))).toBe(true);
    expect(sameGoal(a, toTaskGoal(goal({ tokensUsed: 5 })))).toBe(false);
    expect(sameGoal(a, toTaskGoal(goal({ status: "paused" })))).toBe(false);
    expect(sameGoal(a, null)).toBe(false);
    expect(sameGoal(null, null)).toBe(true);
  });
});

describe("TaskState.goal：来自 get_state 和 goal_updated", () => {
  it("握手时 get_state 带着暂停的目标（进程启动时恢复的目标是 paused）→ TaskState.goal", async () => {
    const paused = goal({ status: "paused", tokenBudget: 1000, tokensUsed: 40 });
    const { id, latest } = await start(await fixtureWith([], modeState(paused)));
    expect(latest(id)?.goal).toEqual({
      id: "g1",
      objective: "写 hello.txt",
      status: "paused",
      tokensUsed: 40,
      tokenBudget: 1000,
      timeUsedSeconds: 0,
    });
  });

  it("get_state 没有 goal 字段时为 null", async () => {
    const { id, latest } = await start(await fixtureWith([]));
    expect(latest(id)?.goal).toBeNull();
  });

  it("goal_updated 逐条进入 TaskState（用量、budget-limited），complete（state.mode 为 exiting）后目标消失", async () => {
    const fixture = await fixtureWith([
      // 事件在主进程发出这条命令之后才推：回放按顺序写出，应答到达时前面的事件都已处理。
      { kind: "in", frame: { type: "goal", op: "get", id: "g0" } },
      goalEvent(goal({ tokenBudget: 2000 }), modeState(goal({ tokenBudget: 2000 }))),
      goalEvent(goal({ tokenBudget: 2000, tokensUsed: 8758, timeUsedSeconds: 2 })),
      goalEvent(goal({ tokenBudget: 2000, tokensUsed: 9323, status: "budget-limited" })),
      goalEvent(
        goal({ tokenBudget: 2000, tokensUsed: 9323, status: "complete" }),
        modeState(goal({ status: "complete" }), { enabled: false, mode: "exiting", reason: "completed" }),
      ),
      goalOk("g0", null),
    ]);
    const { pool, id, states } = await start(fixture);
    await pool.taskGoal(id, "get");
    const seen = states
      .filter((s) => s.id === id)
      .map((s) => s.goal && `${s.goal.status}:${s.goal.tokensUsed}`)
      .filter((value, index, all) => index === 0 || value !== all[index - 1]);
    expect(seen).toEqual([null, "active:0", "active:8758", "budget-limited:9323", null]);
  });
});

describe("taskGoal：RPC goal 的各个 op", () => {
  it("create 带 objective；pause → resume → drop 不带；每次返回操作后的目标，drop 之后为 null", async () => {
    const active = goal();
    const paused = goal({ status: "paused" });
    const fixture = await fixtureWith([
      { kind: "in", frame: { type: "goal", op: "create", objective: "写 hello.txt", id: "c1" } },
      goalEvent(active, modeState(active)),
      goalOk("c1", active),
      { kind: "in", frame: { type: "goal", op: "pause", id: "c2" } },
      goalEvent(paused, modeState(paused)),
      goalOk("c2", paused),
      { kind: "in", frame: { type: "goal", op: "resume", id: "c3" } },
      goalEvent(active, modeState(active)),
      goalOk("c3", active),
      { kind: "in", frame: { type: "goal", op: "drop", id: "c4" } },
      goalEvent(goal({ status: "dropped" }), modeState(goal({ status: "dropped" }), { enabled: false })),
      goalOk("c4", null),
    ]);
    const { pool, id, inputLog, latest } = await start(fixture);

    expect(await pool.taskGoal(id, "create", "写 hello.txt")).toMatchObject({
      status: "active",
      objective: "写 hello.txt",
    });
    expect(latest(id)?.goal?.status).toBe("active");
    expect(await pool.taskGoal(id, "pause")).toMatchObject({ status: "paused" });
    expect(latest(id)?.goal?.status).toBe("paused");
    expect(await pool.taskGoal(id, "resume")).toMatchObject({ status: "active" });
    expect(await pool.taskGoal(id, "drop")).toBeNull();
    expect(latest(id)?.goal).toBeNull();

    expect(await sentGoalOps(inputLog)).toEqual([
      { type: "goal", op: "create", objective: "写 hello.txt" },
      { type: "goal", op: "pause" },
      { type: "goal", op: "resume" },
      { type: "goal", op: "drop" },
    ]);
  });

  it("omp 拒绝（已有目标等）时 reject，原文透传，TaskState.goal 不变", async () => {
    const active = goal();
    const fixture = await fixtureWith(
      [
        { kind: "in", frame: { type: "goal", op: "create", objective: "第二个", id: "c1" } },
        response("c1", { success: false, error: "A goal is already active or paused." }),
      ],
      modeState(active),
    );
    const { pool, id, latest } = await start(fixture);
    expect(latest(id)?.goal?.status).toBe("active");
    await expect(pool.taskGoal(id, "create", "第二个")).rejects.toThrow("A goal is already active or paused.");
    expect(latest(id)?.goal?.status).toBe("active");
  });
});
