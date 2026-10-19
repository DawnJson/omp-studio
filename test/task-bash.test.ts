// `!命令`：runBash 经 RPC bash 发给 omp，结果作为 bashExecution 消息进对话流；abortBash 只在命令在跑时发 abort_bash。
// omp 对 bash 不推任何事件帧（实测：只有一条 response，消息随后能从 get_messages 读到），所以对话流里的那条是主进程合成的。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StudioSettings, TaskId, TaskState } from "../src/shared/ipc.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio bash-"));
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

type Entry = Record<string, unknown>;
interface RecordedLine extends Entry {
  frame?: { type?: string };
}

/** 握手部分取 simple-reply 录制里 prompt 之前的条目，后面接这条测试自己的 bash 往返。 */
async function fixtureWith(tail: Entry[]): Promise<string> {
  const lines = (await readFile(path.join(root, "fixtures", "rpc", "simple-reply.ndjson"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line): RecordedLine => JSON.parse(line));
  const promptAt = lines.findIndex((entry) => entry.frame?.type === "prompt");
  const file = path.join(await mkdtemp(path.join(scratch, "fx-")), "bash.ndjson");
  const entries = [...lines.slice(0, promptAt), ...tail, { kind: "hang" }];
  await writeFile(file, entries.map((entry) => JSON.stringify(entry)).join("\n"));
  return file;
}

const response = (id: string, extra: Entry): Entry => ({
  kind: "out",
  frame: { id, type: "response", command: "bash", ...extra },
});

const pools: TaskPool[] = [];
async function start(fixture: string): Promise<{ pool: TaskPool; id: TaskId; inputLog: string }> {
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
  await vi.waitFor(() => expect(states.findLast((s) => s.id === created.id)?.status).toBe("idle"), { timeout: 15_000 });
  return { pool, id: created.id, inputLog };
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

const sentTypes = async (inputLog: string): Promise<string[]> =>
  (await readFile(inputLog, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line): string => {
      const frame: { type: string } = JSON.parse(line);
      return frame.type;
    });

async function bashMessages(pool: TaskPool, id: TaskId) {
  const snapshot = await pool.openTask(id);
  return snapshot.transcript.items.flatMap((item) =>
    item.kind === "message" && item.message.role === "bashExecution" ? [item.message] : [],
  );
}

describe("runBash：发 RPC bash，结果进对话流", () => {
  it("应答里的输出、退出码、截断标志变成 bashExecution 消息；没有命令在跑时 abortBash 什么也不发", async () => {
    const fixture = await fixtureWith([
      { kind: "in", frame: { type: "bash", command: "echo hi; exit 3", id: "b1" } },
      response("b1", {
        success: true,
        data: { exitCode: 3, cancelled: false, output: "hi\n", truncated: true, totalLines: 2, totalBytes: 3 },
      }),
    ]);
    const { pool, id, inputLog } = await start(fixture);
    await pool.abortBash(id);
    await pool.runBash(id, "echo hi; exit 3");

    expect(await bashMessages(pool, id)).toEqual([
      expect.objectContaining({
        role: "bashExecution",
        command: "echo hi; exit 3",
        output: "hi\n",
        exitCode: 3,
        cancelled: false,
        truncated: true,
      }),
    ]);
    expect(await sentTypes(inputLog)).toContain("bash");
    expect(await sentTypes(inputLog)).not.toContain("abort_bash");
  });

  it("omp 拒绝（失败应答）时抛出错误，对话流里没有这条", async () => {
    const fixture = await fixtureWith([
      { kind: "in", frame: { type: "bash", command: "ls", id: "b1" } },
      response("b1", { success: false, error: "A bash command is already running" }),
    ]);
    const { pool, id } = await start(fixture);
    await expect(pool.runBash(id, "ls")).rejects.toThrow(/already running/);
    expect(await bashMessages(pool, id)).toEqual([]);
  });

  it("空命令不发给 omp", async () => {
    const { pool, id, inputLog } = await start(await fixtureWith([]));
    await expect(pool.runBash(id, "   ")).rejects.toThrow(/empty/);
    expect(await sentTypes(inputLog)).not.toContain("bash");
  });

  it("命令在跑时 abortBash 发 abort_bash，被取消的结果记成 cancelled", async () => {
    const fixture = await fixtureWith([
      { kind: "in", frame: { type: "bash", command: "sleep 60", id: "b1" } },
      { kind: "in", frame: { type: "abort_bash", id: "a1" } },
      { kind: "out", frame: { id: "a1", type: "response", command: "abort_bash", success: true } },
      response("b1", {
        success: true,
        data: { cancelled: true, output: "", truncated: false, totalLines: 0, totalBytes: 0 },
      }),
    ]);
    const { pool, id, inputLog } = await start(fixture);
    const running = pool.runBash(id, "sleep 60");
    await vi.waitFor(async () => expect(await sentTypes(inputLog)).toContain("bash"));
    await pool.abortBash(id);
    await running;

    expect(await sentTypes(inputLog)).toContain("abort_bash");
    expect(await bashMessages(pool, id)).toEqual([expect.objectContaining({ command: "sleep 60", cancelled: true })]);
  });

  it("进程还没就绪（bash 请求发出前）收到的 abortBash 不丢：bash 发出后立刻补发 abort_bash", async () => {
    const fixture = await fixtureWith([
      { kind: "in", frame: { type: "bash", command: "sleep 60", id: "b1" } },
      { kind: "in", frame: { type: "abort_bash", id: "a1" } },
      { kind: "out", frame: { id: "a1", type: "response", command: "abort_bash", success: true } },
      response("b1", {
        success: true,
        data: { cancelled: true, output: "", truncated: false, totalLines: 0, totalBytes: 0 },
      }),
    ]);
    const { pool, id, inputLog } = await start(fixture);
    // runBash 同步计数，随后的 abortBash 一定落在 #live() 完成之前（bash 请求尚未发出）。
    const running = pool.runBash(id, "sleep 60");
    await pool.abortBash(id);
    await running;

    const types = await sentTypes(inputLog);
    expect(types.indexOf("abort_bash")).toBeGreaterThan(types.indexOf("bash"));
    expect(await bashMessages(pool, id)).toEqual([expect.objectContaining({ cancelled: true })]);
  });
});
