// TSP 任务的会话树、回溯、分叉（docs/architecture/session-tree.md）：任务池 + TspRunner + 假 omp（fake-tsp-omp 回放 omp 18.12.5 录的
// fixtures/tsp/session-tree.jsonl：`/tree` → activate 用户消息 → 清空预填的输入框）。会话文件是 fixtures/omp-session 里 omp 真实产出的那份。
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProjectId, StudioSettings, TaskId, TaskState } from "../src/shared/ipc.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry, type TaskRecord } from "../src/main/tasks/task-registry.ts";
import { buildTspArgs } from "../src/main/omp/launch-args.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeTsp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
const ALPHA = "beac8e08";
const BETA = "b772c2f5";
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-tsp-tree-"));
  projectDir = path.join(scratch, "project");
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
  soundOnDone: false,
  copyOnSelect: true,
  yoloConfirmed: false,
};

interface Launch {
  taskId: TaskId;
  sessionFile: string | null;
  forkFrom: string | null;
  args: string[];
}

interface Harness {
  pool: TaskPool;
  registry: TaskRegistry;
  projectId: ProjectId;
  launches: Launch[];
  log: string;
  /** 假 omp 报告的会话文件（FAKE_TSP_SESSION_FILE）；null = 不报告。 */
  sessionFile: { current: string | null };
  /** 假 omp 回放的录制（fixtures/tsp/<名字>.jsonl）。 */
  fixture: { current: string };
  states: TaskState[];
}

const pools: TaskPool[] = [];
let counter = 0;

async function harness(): Promise<Harness> {
  counter += 1;
  const states: TaskState[] = [];
  const registry = new TaskRegistry(path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json"));
  const launches: Launch[] = [];
  const log = path.join(scratch, `omp-log-${counter}.jsonl`);
  const sessionFile: { current: string | null } = { current: null };
  const fixture = { current: "session-tree" };
  const pool = new TaskPool({
    registry,
    getSettings: async () => settings,
    events: {
      state: (state) => states.push(state),
      notice: () => {},
      taskRemoved: () => {},
      tspBatch: () => {},
    },
    listModels: async () => [],
    forkTitle: (title) => `分叉：${title}`,
    newTaskDefaults: async () => ({ model: null, thinkingLevel: null, ompDefault: null }),
    tsp: {
      buildLaunch: async (record: TaskRecord, project) => {
        launches.push({
          taskId: record.id,
          sessionFile: record.sessionFile,
          forkFrom: record.forkFrom ?? null,
          // 和 runtime.ts 里同一个参数拼法：恢复用 --resume，分叉用 --fork。
          args: buildTspArgs({
            cwd: project.path,
            resumeSessionFile: record.sessionFile,
            forkSessionFile: record.forkFrom ?? null,
          }),
        });
        return {
          command: process.execPath,
          args: [fakeTsp, fixture.current, "--speed=100", `--log=${log}`],
          cwd: record.worktreePath ?? project.path,
          env: { ...process.env, ...(sessionFile.current !== null && { FAKE_TSP_SESSION_FILE: sessionFile.current }) },
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
  return { pool, registry, projectId: project.id, launches, log, sessionFile, fixture, states };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

async function until<T>(read: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    // 假 omp 在另一个进程里，它的收件记录只能轮询文件（同 task-tsp.test.ts）。
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** 假 omp（另一个进程）的收件记录里用户操作（不含 ack）。 */
function received(log: string): Record<string, unknown>[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
    .filter((record) => record.kind === "tsp" && record.body !== undefined)
    .map((record) => record.body as Record<string, unknown>)
    .filter((body) => ["send", "activate", "edit", "select", "action"].includes(String(body["ev"])));
}

/** 起一个有会话文件的 TSP 任务：会话文件是 omp 产出的 linear.jsonl 的副本（放在假 agent 目录里）。 */
async function taskWithSession(h: Harness, session = "linear"): Promise<{ id: TaskId; file: string }> {
  const file = path.join(scratch, `agent-${counter}`, "sessions", "--e2e--", "2026-10-21T18-14-31-448Z_linear.jsonl");
  await mkdir(path.dirname(file), { recursive: true });
  await copyFile(path.join(root, "fixtures", "omp-session", `${session}.jsonl`), file);
  h.sessionFile.current = file;
  const created = await h.pool.createTask({ projectId: h.projectId });
  await until(() => h.states.findLast((s) => s.id === created.id && s.status === "idle"), "the task to be idle");
  await until(() => h.registry.findTask(created.id)?.sessionFile === file, "the session file to be recorded");
  return { id: created.id, file };
}

describe("getSessionTree（TSP：只读会话文件）", () => {
  it("读 omp 的会话文件建树，不拉起进程也行；还没有会话文件时 nodes 为空", async () => {
    const h = await harness();
    const { id } = await taskWithSession(h);
    const { nodes } = await h.pool.getSessionTree(id);
    expect(nodes.map((node) => [node.entryId, node.indent, node.current])).toEqual([
      [ALPHA, 0, false],
      [BETA, 0, true],
    ]);

    // 没有会话文件的任务（omp 没报告文件）：空树，不报错。
    h.sessionFile.current = null;
    const blank = await h.pool.createTask({ projectId: h.projectId });
    expect(await h.pool.getSessionTree(blank.id)).toEqual({ nodes: [] });
  }, 60_000);
});

describe("branchTask（TSP：驱动 omp 自己的 /tree）", () => {
  it("send /tree → activate 那条用户消息 → 清空 omp 预填的输入框；返回会话文件里的完整文字；之后树里的当前位置跟着变", async () => {
    const h = await harness();
    const { id } = await taskWithSession(h);
    const result = await h.pool.branchTask(id, BETA);
    expect(result).toEqual({ text: "Reply with exactly: BETA. No tools.", summarized: false });
    expect(received(h.log)).toEqual([
      { ev: "send", sf: "s:1", id: "j.line/input", text: "/tree" },
      { ev: "activate", sf: "s:1", id: "s.^picker", item: BETA },
      { ev: "edit", sf: "s:1", id: "j.line/input", from: 0, to: 35, text: "", cursor: 0, len: 35 },
    ]);
    // 回溯不新建会话文件，任务仍记原来的。
    expect(h.registry.findTask(id)?.sessionFile).toBe(h.sessionFile.current);
    // 叶子在 BETA 的父条目（文件还没长新条目，靠 override）：BETA 不在当前分支，ALPHA 是当前。
    const { nodes } = await h.pool.getSessionTree(id);
    expect(nodes.map((node) => [node.entryId, node.onCurrentBranch, node.current])).toEqual([
      [ALPHA, true, true],
      [BETA, false, false],
    ]);
  }, 60_000);

  it("不是用户消息（或不在这个会话里）的条目被拒绝，不往 omp 发任何东西", async () => {
    const h = await harness();
    const { id } = await taskWithSession(h);
    await expect(h.pool.branchTask(id, "b05cb500")).rejects.toThrow(/not a user message/);
    await expect(h.pool.branchTask(id, "nope")).rejects.toThrow(/not a user message/);
    expect(received(h.log)).toEqual([]);
  }, 60_000);
});

describe("回溯时的摘要提示、摘要、压缩过的会话（omp 18.12.5 录制）", () => {
  const SPROMPT_A = "5bc4a7a2";
  const SPROMPT_B = "6f8bf37c";

  it('branchSummary.enabled 打开：选了用户消息后 omp 弹"Summarize branch?"，studio 答 No summary（item 0），不超时', async () => {
    const h = await harness();
    h.fixture.current = "session-tree-prompt";
    const { id } = await taskWithSession(h, "prompt");
    expect(await h.pool.branchTask(id, SPROMPT_B)).toEqual({
      text: "Reply with exactly: BETA. No tools.",
      summarized: false,
    });
    expect(received(h.log)).toEqual([
      { ev: "send", sf: "s:1", id: "j.line/input", text: "/tree" },
      { ev: "activate", sf: "s:1", id: "s.^picker", item: SPROMPT_B },
      { ev: "activate", sf: "s:1", id: "t.^picker", item: "0" },
      { ev: "edit", sf: "s:1", id: "j.line/input", from: 0, to: 35, text: "", cursor: 0, len: 35 },
    ]);
  }, 60_000);

  it("summarize=true：选择器里 select + action summarize（omp 的 Shift+Enter），不走摘要提示；返回 summarized:true", async () => {
    const h = await harness();
    h.fixture.current = "session-tree-summarize";
    const { id } = await taskWithSession(h, "prompt");
    expect(await h.pool.branchTask(id, SPROMPT_B, true)).toEqual({
      text: "Reply with exactly: BETA. No tools.",
      summarized: true,
    });
    expect(received(h.log)).toEqual([
      { ev: "send", sf: "s:1", id: "j.line/input", text: "/tree" },
      { ev: "select", sf: "s:1", id: "s.^picker", item: SPROMPT_B },
      { ev: "action", sf: "s:1", id: "s.^picker", act: "summarize" },
      { ev: "edit", sf: "s:1", id: "j.line/input", from: 0, to: 35, text: "", cursor: 0, len: 35 },
    ]);
  }, 60_000);

  it("压缩过的会话：回溯到压缩点之前的消息照常成功；树里列出压缩前后所有用户消息", async () => {
    const h = await harness();
    h.fixture.current = "session-tree-compacted";
    const { id } = await taskWithSession(h, "compacted");
    expect((await h.pool.getSessionTree(id)).nodes.map((node) => [node.entryId, node.current])).toEqual([
      [SPROMPT_A, false],
      [SPROMPT_B, true],
    ]);
    expect(await h.pool.branchTask(id, SPROMPT_A)).toMatchObject({ text: "Reply with exactly: ALPHA. No tools." });
    expect(received(h.log).map((event) => event["ev"])).toEqual(["send", "activate", "edit"]);
  }, 60_000);
});

describe("forkTask（TSP：omp --fork 起新任务，再在新进程里回溯）", () => {
  it("新任务记 forkFrom 并用 --fork=<原会话文件> 起；回溯后返回文字；新任务同项目；原任务不动", async () => {
    const h = await harness();
    const { id, file } = await taskWithSession(h);
    const result = await h.pool.forkTask(id, BETA);
    expect(result.text).toBe("Reply with exactly: BETA. No tools.");
    expect(result.task.id).not.toBe(id);
    expect(result.task).toMatchObject({ projectId: h.projectId });

    const forkLaunch = h.launches.find((launch) => launch.taskId === result.task.id);
    expect(forkLaunch).toMatchObject({ sessionFile: null, forkFrom: file, args: [`--fork=${file}`] });
    // 原任务只启动过一次、没有被动过（没有往它的进程里发过 /tree：log 里的 /tree 只来自新进程）。
    expect(h.launches.filter((launch) => launch.taskId === id)).toHaveLength(1);
    expect(received(h.log).filter((event) => event["ev"] === "send")).toHaveLength(1);
    expect(h.registry.findTask(id)?.sessionFile).toBe(file);
  }, 60_000);

  it("不带条目（null）= 当前分支最后一条用户消息；新文件落盘后记进 sessionFile 并清掉 forkFrom，之后恢复用 --resume", async () => {
    const h = await harness();
    const { id, file } = await taskWithSession(h);
    const { task, text } = await h.pool.forkTask(id, null);
    expect(text).toBe("Reply with exactly: BETA. No tools.");
    // 假 omp 报告的会话文件就是 FAKE_TSP_SESSION_FILE（真实 omp 报告的是新建的那份）：落盘后记进记录、forkFrom 清掉。
    await until(() => h.registry.findTask(task.id)?.sessionFile === file, "the forked task's session file");
    expect(h.registry.findTask(task.id)?.forkFrom ?? null).toBeNull();
    expect(buildTspArgs({ cwd: projectDir, resumeSessionFile: file, forkSessionFile: null })).toEqual([
      `--resume=${file}`,
    ]);
  }, 60_000);

  it("没有会话文件、或指的不是用户消息时拒绝，不建任务", async () => {
    const h = await harness();
    h.sessionFile.current = null;
    const blank = await h.pool.createTask({ projectId: h.projectId });
    await expect(h.pool.forkTask(blank.id, null)).rejects.toThrow(/no session file yet/);

    const { id } = await taskWithSession(h);
    const before = h.registry.listTasks().length;
    await expect(h.pool.forkTask(id, "b05cb500")).rejects.toThrow(/not a user message/);
    expect(h.registry.listTasks()).toHaveLength(before);
  }, 60_000);
});

describe("启动参数", () => {
  it("分叉任务第一次启动用 --fork=<路径>；已有会话文件时 --resume 优先（forkFrom 残留也不会再次分叉）", () => {
    expect(buildTspArgs({ cwd: "C:/p", forkSessionFile: "C:/a b/x.jsonl" })).toEqual(["--fork=C:/a b/x.jsonl"]);
    expect(buildTspArgs({ cwd: "C:/p", resumeSessionFile: "C:/r.jsonl", forkSessionFile: "C:/a.jsonl" })).toEqual([
      "--resume=C:/r.jsonl",
    ]);
    expect(buildTspArgs({ cwd: "C:/p", forkSessionFile: null })).toEqual([]);
  });
});
