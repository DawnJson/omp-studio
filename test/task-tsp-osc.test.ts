// TSP 任务里 omp 的终端序列 OSC 7501（程序状态）、OSC 7（当前目录）、OSC 0（标题后缀 ` · #PR`）、loader 如何进 TaskState。
// 进程是 test/fake-omp/fake-tsp-omp.ts：在 omp 的真实录制里按位置插入 `osc` 行回放（字节来自真实 omp 18.12.6 的实测，
// docs/architecture/tsp-migration.md §7）。和 task-tsp.test.ts 同一套做法，单独成文件免得和它的 harness 互相牵扯。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StudioSettings, TaskId, TaskState } from "../src/shared/ipc.ts";
import type { TspEvent } from "../src/shared/tsp/tsp.generated.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";
import { isRecord } from "../src/shared/type-guards.ts";
import { loadTspFixture, recordedUserEvents, type TspRecordLine } from "./tsp-fixtures.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeTsp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-tsp-osc-"));
  projectDir = path.join(scratch, "project");
  await mkdir(projectDir);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const settings = (): StudioSettings => ({
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses: 6,
  idleClose: "1h",
  reduceMotion: false,
  enterWhileRunning: "steer",
  soundOnDone: false,
  copyOnSelect: true,
  fontSize: 15,
  yoloConfirmed: false,
});

class Events {
  states: TaskState[] = [];
  #waiters: { predicate: (state: TaskState) => boolean; resolve: (state: TaskState) => void }[] = [];

  readonly sink = {
    state: (state: TaskState) => {
      this.states.push(state);
      this.#waiters = this.#waiters.filter((waiter) =>
        waiter.predicate(state) ? (waiter.resolve(state), false) : true,
      );
    },
    notice: () => {},
    taskRemoved: () => {},
    tspBatch: () => {},
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

const pools: TaskPool[] = [];
let counter = 0;

async function harness(tasksFile?: string) {
  counter += 1;
  const events = new Events();
  const file = tasksFile ?? path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json");
  const registry = new TaskRegistry(file);
  const launchCwds: string[] = [];
  const next = { fixture: "slash", env: {} as Record<string, string> };
  const pool = new TaskPool({
    registry,
    getSettings: async () => settings(),
    events: events.sink,
    listModels: async () => [],
    newTaskDefaults: async () => ({ model: null, thinkingLevel: null, ompDefault: null }),
    tsp: {
      buildLaunch: async (record, project) => {
        // 和 runtime.ts 的 buildLaunch 同一个优先级：omp 里 `/move` 过的目录 > worktree 根 > 项目目录。
        const cwd = record.cwd ?? record.worktreePath ?? project.path;
        launchCwds.push(cwd);
        return {
          command: process.execPath,
          args: [fakeTsp, next.fixture, "--speed=100"],
          cwd,
          env: { ...process.env, ...next.env },
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
  return { pool, events, registry, tasksFile: file, projectId: project.id, launchCwds, next };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

const b64 = (text: string) => Buffer.from(text).toString("base64");
const osc7501 = (state: string) => `7501;${state}:app=omp`;

/**
 * 在 omp 的录制里插 `osc` 行：`before` 是第几条会改文档的消息（o / f / t / x / b，序号从 0 起，同 tsp-task-status.test.ts）之前，
 * `-1` = 放最前面。插入的行沿用它前面那条消息的时间。
 */
async function withOsc(
  name: string,
  inserts: { before: number; body: string }[],
  keepUserEvents = true,
): Promise<string> {
  const lines = loadTspFixture(name);
  const out: TspRecordLine[] = [];
  let index = 0;
  const flush = (at: number, t: number) => {
    for (const insert of inserts) if (insert.before === at) out.push({ t, dir: "out", verb: "osc", body: insert.body });
  };
  flush(-1, lines[0]?.t ?? 0);
  for (const line of lines) {
    const isMessage = line.dir === "out" && ["o", "f", "t", "x", "b"].includes(line.verb);
    if (isMessage) flush(index, line.t);
    if (line.dir === "in" && !keepUserEvents && isRecord(line.body) && line.body["ev"] !== "ack") continue;
    out.push(line);
    if (isMessage) index += 1;
  }
  const file = path.join(scratch, `fixture-${name}-${(counter += 1)}.jsonl`);
  await writeFile(file, out.map((line) => JSON.stringify(line)).join("\n"));
  return file;
}

/** approval 录制里用户的两个操作：发的那句话、点 Approve。 */
function approvalEvents(): { text: string; approve: TspEvent } {
  const [send, approve] = recordedUserEvents(loadTspFixture("approval")).map(
    (entry) => entry.event as unknown as TspEvent,
  );
  if (send?.ev !== "send" || !approve) throw new Error("unexpected approval fixture");
  return { text: send.text, approve };
}

// approval 录制的状态边界（tsp-task-status.test.ts）：消息 9 起在跑、17 起等审批、19 起继续跑、22 回空闲。
const ASK = "Allow tool: bash Command: python -c print(1+1)";

describe("OSC 7501 作为任务状态的主信号（approval 录制 + 插入的 7501）", () => {
  it("working → blocked(permission) → 批准后仍是 blocked 到工具结束 → done：running → needs_you → running → idle(完成)", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = await withOsc("approval", [
      { before: -1, body: osc7501("state=idle") },
      { before: 9, body: osc7501("state=working") },
      { before: 17, body: `7501;state=blocked:kind=permission:app=omp:msg=${b64(ASK)}` },
      // 批准之后 omp 不再发新状态（实测）：blocked 一直保持到工具结束，之后才 done。
      { before: 22, body: osc7501("state=done") },
    ]);
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    const waiting = await h.events.until(created.id, (state) => state.status === "needs_you");
    expect(waiting.dialogs[0]).toMatchObject({ kind: "confirm" });

    h.pool.sendTspEvent(created.id, events.approve);
    const done = await h.events.until(
      created.id,
      (state) => state.status === "idle" && state.lastTurn?.status === "completed",
    );
    expect(h.events.statuses(created.id)).toEqual(["starting", "idle", "running", "needs_you", "running", "idle"]);
    expect(done.dialogs).toEqual([]);
    // 门节点到了之后标题以节点为准（输入框的提问 / 审批判断仍然看节点）。
    expect(h.events.states.some((state) => state.dialogs[0]?.title === "Allow tool: bash")).toBe(true);
  }, 60_000);

  it("7501 比节点早：working 到达那一刻任务就是 running，不用等 omp.working 那一帧", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = await withOsc("approval", [{ before: 8, body: osc7501("state=working") }]);
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    const running = await h.events.until(created.id, (state) => state.status === "running");
    expect(running.runStartedAt).not.toBeNull();
  }, 60_000);

  it("state=error：这一轮记为 error，omp 的错误原文进 lastTurn.error.message", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = await withOsc("approval", [
      { before: 9, body: osc7501("state=working") },
      { before: 22, body: osc7501(`state=error:msg=${b64("Couldn't connect to api.deepseek.com 无法连接")}`) },
    ]);
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    await h.events.until(created.id, (state) => state.status === "needs_you");
    h.pool.sendTspEvent(created.id, events.approve);
    const failed = await h.events.until(created.id, (state) => state.status === "idle" && state.lastTurn !== null);
    expect(failed.lastTurn).toMatchObject({
      status: "error",
      error: { message: "Couldn't connect to api.deepseek.com 无法连接" },
    });
  }, 60_000);

  it("state=idle（Esc 中断）：不按停止也记为 aborted", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = await withOsc("approval", [
      { before: 9, body: osc7501("state=working") },
      { before: 22, body: osc7501("state=idle") },
    ]);
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    await h.events.until(created.id, (state) => state.status === "needs_you");
    h.pool.sendTspEvent(created.id, events.approve);
    const ended = await h.events.until(created.id, (state) => state.status === "idle" && state.lastTurn !== null);
    expect(ended.lastTurn?.status).toBe("aborted");
  }, 60_000);

  it("没收到过 7501（terminal.programStatus 关了）：退回节点推导，和以前一样", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = "approval";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    await h.events.until(created.id, (state) => state.status === "needs_you");
    h.pool.sendTspEvent(created.id, events.approve);
    const done = await h.events.until(
      created.id,
      (state) => state.status === "idle" && state.lastTurn?.status === "completed",
    );
    expect(done.dialogs).toEqual([]);
    expect(h.events.statuses(created.id)).toEqual(["starting", "idle", "running", "needs_you", "running", "idle"]);
  }, 60_000);
});

describe("loader 和模态弹窗（7501 不覆盖）", () => {
  it("分支摘要期间 dock 里有 omp.loader：running，TaskState.loaderText 是它的文字，结束后清空", async () => {
    const h = await harness();
    // 录制里的用户操作去掉：回放不等它们，直接把 omp 的帧放完。
    h.next.fixture = await withOsc("session-tree-summarize", [], false);
    const created = await h.pool.createTask({ projectId: h.projectId });
    const loading = await h.events.until(created.id, (state) => state.loaderText !== null);
    expect(loading).toMatchObject({ status: "running" });
    expect(loading.loaderText).toMatch(/^Summarizing branch/);
    const after = await h.events.until(created.id, (state) => state.loaderText === null && state.status === "idle");
    expect(after.loaderText).toBeNull();
  }, 60_000);

  it("扩展的输入弹窗（omp.overlay.hook-editor）开着：needs_you，合成的门 tsp-modal 带弹窗标题", async () => {
    const h = await harness();
    h.next.fixture = await withOsc("goal-drop", [], false);
    const created = await h.pool.createTask({ projectId: h.projectId });
    const waiting = await h.events.until(created.id, (state) => state.status === "needs_you");
    expect(waiting.dialogs[0]).toMatchObject({ id: "tsp-modal", title: "Goal objective" });
  }, 60_000);
});

describe("OSC 7 当前目录", () => {
  /** 真实 omp 的写法：`file://<主机名><pathToFileURL(目录).pathname>`。 */
  const osc7 = (dir: string) => `7;file://${os.hostname()}${pathToFileURL(dir).pathname}`;

  it("`/move` 之后（路径含空格和中文）：TaskState.cwd 跟着变并写进任务记录，重启后从新目录 --resume", async () => {
    const moved = path.join(scratch, "目录 two");
    await mkdir(moved);
    const h = await harness();
    h.next.fixture = await withOsc("slash", [
      { before: -1, body: osc7(projectDir) },
      { before: 3, body: osc7(moved) },
    ]);
    const created = await h.pool.createTask({ projectId: h.projectId });
    expect(created.cwd).toBe(projectDir);
    const state = await h.events.until(created.id, (next) => next.cwd === moved);
    expect(state.cwd).toBe(moved);
    expect(h.pool.taskCwd(created.id)).toBe(moved);
    expect(h.registry.findTask(created.id)?.cwd).toBe(moved);
    // 关掉所有进程模拟退出应用；记录里已经是新目录。
    await h.pool.shutdown();

    const again = await harness(h.tasksFile);
    again.next.fixture = "slash";
    await again.pool.openTask(created.id);
    expect(again.launchCwds).toEqual([moved]);
  }, 60_000);

  it("回到默认目录（项目目录）时记录里的 cwd 清回 null；启动时的 OSC 7 等于启动目录不改任何东西", async () => {
    const moved = path.join(scratch, "elsewhere");
    await mkdir(moved);
    const h = await harness();
    h.next.fixture = await withOsc("slash", [
      { before: -1, body: osc7(projectDir) },
      { before: 2, body: osc7(moved) },
      { before: 4, body: osc7(projectDir) },
    ]);
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.cwd === moved);
    await h.events.until(created.id, (state) => state.cwd === projectDir && state.status === "idle");
    expect(h.registry.findTask(created.id)?.cwd ?? null).toBeNull();
  }, 60_000);

  it("记着的目录已经被删了：启动时退回默认目录，不当成启动失败", async () => {
    const gone = path.join(scratch, "gone dir");
    await mkdir(gone);
    const h = await harness();
    h.next.fixture = await withOsc("slash", [
      { before: -1, body: osc7(projectDir) },
      { before: 2, body: osc7(gone) },
    ]);
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.cwd === gone);
    await h.pool.shutdown();
    await rm(gone, { recursive: true });

    const again = await harness(h.tasksFile);
    again.next.fixture = "slash";
    await again.pool.openTask(created.id);
    await again.events.until(created.id, (state) => state.status === "idle");
    expect(again.launchCwds).toEqual([projectDir]);
    expect(again.registry.findTask(created.id)?.cwd ?? null).toBeNull();
  }, 60_000);
});

describe("标题后缀 ` · #PR`", () => {
  it("标题去掉后缀，PR 号进 TaskState.prNumber；`omp · #7`（没有标题只有 PR）标题为空", async () => {
    const h = await harness();
    h.next.env = { FAKE_TSP_TITLE: "\u{f1821} 修复 登录 bug · #12" };
    const first = await h.pool.createTask({ projectId: h.projectId });
    const titled = await h.events.until(first.id, (state) => state.prNumber === 12 && state.title !== "");
    expect(titled.title).toBe("修复 登录 bug");

    h.next.env = { FAKE_TSP_TITLE: "omp · #7" };
    const second = await h.pool.createTask({ projectId: h.projectId });
    const bare = await h.events.until(second.id, (state) => state.prNumber === 7);
    expect(bare.title).toBe("");
  }, 60_000);
});
