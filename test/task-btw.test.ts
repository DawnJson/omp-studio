// `/btw` 旁路提问：askBtw 经 RPC btw 发给 omp，btw_record / btw_delta 帧作为 btw 事件推给渲染进程（不进对话流）；
// cancelBtw 发 btw_cancel；getBtw 第一次读 get_btw_history。语义来自真实 omp 实测（docs/architecture/conversation.md「旁路提问」）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyBtwEvent, isBtwRunning, type BtwHistoryRecord, type BtwUiEvent } from "../src/shared/btw.ts";
import type { StudioSettings, TaskId, TaskState } from "../src/shared/ipc.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio btw-"));
  projectDir = path.join(scratch, "项目");
  await mkdir(projectDir);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const settings: StudioSettings = {
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses: 6,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  copyOnSelect: true,
  taskEngine: "rpc",
  yoloConfirmed: false,
};

type Entry = Record<string, unknown>;
interface RecordedLine extends Entry {
  frame?: { type?: string };
}

/** 握手部分取 simple-reply 录制里 prompt 之前的条目，后面接这条测试自己的 btw 往返。 */
async function fixtureWith(tail: Entry[]): Promise<string> {
  const lines = (await readFile(path.join(root, "fixtures", "rpc", "simple-reply.ndjson"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line): RecordedLine => JSON.parse(line));
  const promptAt = lines.findIndex((entry) => entry.frame?.type === "prompt");
  const file = path.join(await mkdtemp(path.join(scratch, "fx-")), "btw.ndjson");
  const entries = [...lines.slice(0, promptAt), ...tail, { kind: "hang" }];
  await writeFile(file, entries.map((entry) => JSON.stringify(entry)).join("\n"));
  return file;
}

const topic = (patch: Partial<BtwHistoryRecord> = {}): BtwHistoryRecord => ({
  id: "t1",
  leafId: "leaf",
  question: "Reply with exactly the word: pong",
  answer: "",
  status: "running",
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const out = (frame: Entry): Entry => ({ kind: "out", frame });
const input = (frame: Entry): Entry => ({ kind: "in", frame });
const respond = (id: string, command: string, data: unknown): Entry =>
  out({ id, type: "response", command, success: true, data });
const btwRecord = (record: BtwHistoryRecord): Entry => out({ type: "btw_record", record });
const btwDelta = (recordId: string, delta: string): Entry => out({ type: "btw_delta", recordId, delta });

const pools: TaskPool[] = [];
interface Started {
  pool: TaskPool;
  id: TaskId;
  inputLog: string;
  /** 按到达顺序收到的 btw 事件。 */
  events: BtwUiEvent[];
  /** 用同一条规则把事件推进成的记录列表（渲染进程看到的样子）。 */
  mirror(): readonly BtwHistoryRecord[];
}

async function start(fixture: string): Promise<Started> {
  const inputLog = path.join(path.dirname(fixture), "input.log");
  const states: TaskState[] = [];
  const events: BtwUiEvent[] = [];
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
      btw: (_taskId, event) => events.push(event),
    },
  });
  pools.push(pool);
  await pool.init();
  const project = await pool.ensureProject(projectDir);
  const created = await pool.createTask({ projectId: project.id });
  await vi.waitFor(() => expect(states.findLast((s) => s.id === created.id)?.status).toBe("idle"), { timeout: 15_000 });
  return {
    pool,
    id: created.id,
    inputLog,
    events,
    mirror: () => events.reduce<readonly BtwHistoryRecord[]>(applyBtwEvent, []),
  };
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

const sentFrames = async (inputLog: string): Promise<Record<string, unknown>[]> =>
  (await readFile(inputLog, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line): Record<string, unknown> => JSON.parse(line));

describe("askBtw：发 RPC btw，答案经 btw 事件流回来", () => {
  it("record(running) → 应答 → delta → record(complete)：事件按序到达，累积出完整答案，主对话流不变", async () => {
    const fixture = await fixtureWith([
      input({ type: "btw", question: "Reply with exactly the word: pong", id: "b1" }),
      btwRecord(topic()),
      respond("b1", "btw", { record: topic() }),
      btwDelta("t1", "p"),
      btwDelta("t1", "ong"),
      btwRecord(topic({ answer: "pong", status: "complete", updatedAt: 2 })),
    ]);
    const { pool, id, inputLog, events, mirror } = await start(fixture);
    const before = (await pool.openTask(id)).transcript.items.length;

    expect(await pool.askBtw(id, "  Reply with exactly the word: pong  ")).toBe("t1");
    await vi.waitFor(() => expect(mirror()[0]?.status).toBe("complete"));

    expect(events.map((event) => event.type)).toEqual(["record", "delta", "delta", "record"]);
    expect(mirror()).toEqual([topic({ answer: "pong", status: "complete", updatedAt: 2 })]);
    expect((await sentFrames(inputLog)).find((frame) => frame["type"] === "btw")).toMatchObject({
      question: "Reply with exactly the word: pong",
    });
    expect((await sentFrames(inputLog)).find((frame) => frame["type"] === "btw")).not.toHaveProperty("recordId");
    expect((await pool.openTask(id)).transcript.items).toHaveLength(before);
  });

  it("recordId 给了就是追问：帧里带 recordId，delta 累加到追问上", async () => {
    const followUp = { question: "Now say: ping", answer: "", status: "running", createdAt: 3, updatedAt: 3 } as const;
    const first = topic({ answer: "pong", status: "complete", updatedAt: 2 });
    const fixture = await fixtureWith([
      input({ type: "btw", question: "Reply with exactly the word: pong", id: "b1" }),
      btwRecord(topic()),
      respond("b1", "btw", { record: topic() }),
      btwDelta("t1", "pong"),
      btwRecord(first),
      input({ type: "btw", question: "Now say: ping", recordId: "t1", id: "b2" }),
      btwRecord({ ...first, followUps: [followUp] }),
      respond("b2", "btw", { record: { ...first, followUps: [followUp] } }),
      btwDelta("t1", "ping"),
    ]);
    const { pool, id, inputLog, mirror } = await start(fixture);

    await pool.askBtw(id, "Reply with exactly the word: pong");
    await vi.waitFor(() => expect(mirror()[0]?.status).toBe("complete"));
    await pool.askBtw(id, "Now say: ping", "t1");
    await vi.waitFor(() => expect(mirror()[0]?.followUps?.[0]?.answer).toBe("ping"));

    expect(mirror()[0]).toMatchObject({ answer: "pong", followUps: [{ question: "Now say: ping", answer: "ping" }] });
    expect((await sentFrames(inputLog)).filter((frame) => frame["type"] === "btw")[1]).toMatchObject({
      recordId: "t1",
    });
  });

  it("空问题、过长的问题、不认识的话题 id 在本地被拒绝，不发给 omp", async () => {
    const { pool, id, inputLog } = await start(await fixtureWith([]));
    await expect(pool.askBtw(id, "   ")).rejects.toThrow(/empty/);
    await expect(pool.askBtw(id, "x".repeat(9_000))).rejects.toThrow(/too long/);
    await expect(pool.askBtw(id, "hi", "nope")).rejects.toThrow(/unknown side-question topic/);
    expect((await sentFrames(inputLog)).map((frame) => frame["type"])).not.toContain("btw");
  });

  it("omp 拒绝（已有一条在跑）时原样抛出错误，镜像里没有新记录", async () => {
    const fixture = await fixtureWith([
      input({ type: "btw", question: "second", id: "b1" }),
      out({
        id: "b1",
        type: "response",
        command: "btw",
        success: false,
        error: "A /btw question is still running; cancel it first",
      }),
    ]);
    const { pool, id, mirror } = await start(fixture);
    await expect(pool.askBtw(id, "second")).rejects.toThrow(/still running/);
    expect(mirror()).toEqual([]);
  });

  it("应答里的记录只在 btw_record 帧没到时才补上，不盖掉已累积的 delta", async () => {
    const fixture = await fixtureWith([
      input({ type: "btw", question: "q", id: "b1" }),
      // 应答先于 record 帧：镜像从应答里得到记录。
      respond("b1", "btw", { record: topic({ question: "q" }) }),
      btwDelta("t1", "ab"),
      btwRecord(topic({ question: "q", answer: "ab", status: "complete", updatedAt: 2 })),
    ]);
    const { pool, id, mirror } = await start(fixture);
    await pool.askBtw(id, "q");
    await vi.waitFor(() => expect(mirror()[0]?.status).toBe("complete"));
    expect(mirror()[0]?.answer).toBe("ab");
  });
});

describe("cancelBtw：发 btw_cancel", () => {
  it("省略 recordId 取消在跑的那条（帧里没有 recordId），被取消的记录经 btw_record 回来", async () => {
    const fixture = await fixtureWith([
      input({ type: "btw", question: "essay", id: "b1" }),
      btwRecord(topic({ question: "essay" })),
      respond("b1", "btw", { record: topic({ question: "essay" }) }),
      input({ type: "btw_cancel", id: "c1" }),
      btwRecord(topic({ question: "essay", status: "cancelled", updatedAt: 2 })),
      respond("c1", "btw_cancel", { cancelled: true }),
    ]);
    const { pool, id, inputLog, mirror } = await start(fixture);
    await pool.askBtw(id, "essay");
    expect(isBtwRunning(mirror())).toBe(true);

    expect(await pool.cancelBtw(id)).toBe(true);
    await vi.waitFor(() => expect(mirror()[0]?.status).toBe("cancelled"));
    expect(isBtwRunning(mirror())).toBe(false);
    const cancel = (await sentFrames(inputLog)).find((frame) => frame["type"] === "btw_cancel");
    expect(cancel).toBeDefined();
    expect(cancel).not.toHaveProperty("recordId");
  });

  it("带 recordId 时帧里带上它；omp 说没有可取消的（cancelled: false）就返回 false", async () => {
    const fixture = await fixtureWith([
      input({ type: "btw", question: "q", id: "b1" }),
      btwRecord(topic({ question: "q", answer: "a", status: "complete", updatedAt: 2 })),
      respond("b1", "btw", { record: topic({ question: "q", answer: "a", status: "complete", updatedAt: 2 }) }),
      input({ type: "btw_cancel", recordId: "t1", id: "c1" }),
      respond("c1", "btw_cancel", { cancelled: false }),
    ]);
    const { pool, id, inputLog } = await start(fixture);
    await pool.askBtw(id, "q");
    expect(await pool.cancelBtw(id, "t1")).toBe(false);
    expect((await sentFrames(inputLog)).find((frame) => frame["type"] === "btw_cancel")).toMatchObject({
      recordId: "t1",
    });
  });

  it("不认识的话题 id 在本地被拒绝，不发给 omp", async () => {
    const { pool, id, inputLog } = await start(await fixtureWith([]));
    await expect(pool.cancelBtw(id, "nope")).rejects.toThrow(/unknown side-question topic/);
    expect((await sentFrames(inputLog)).map((frame) => frame["type"])).not.toContain("btw_cancel");
  });
});

describe("getBtw：历史", () => {
  it("第一次读 get_btw_history 并推一份 records 事件；同一进程里之后直接用镜像", async () => {
    const history = [topic({ id: "h2", answer: "x", status: "complete" }), topic({ id: "h1", status: "cancelled" })];
    const fixture = await fixtureWith([
      input({ type: "get_btw_history", id: "h" }),
      respond("h", "get_btw_history", { records: history }),
    ]);
    const { pool, id, inputLog, events } = await start(fixture);

    expect(await pool.getBtw(id)).toEqual(history);
    expect(await pool.getBtw(id)).toEqual(history);
    expect(events).toEqual([{ type: "records", records: history }]);
    expect((await sentFrames(inputLog)).filter((frame) => frame["type"] === "get_btw_history")).toHaveLength(1);
  });

  it("进程在提问中退出：镜像里在跑的那条被标成 interrupted，并推一份 records 事件", async () => {
    const fixture = await fixtureWith([
      input({ type: "btw", question: "q", id: "b1" }),
      btwRecord(topic({ question: "q" })),
      respond("b1", "btw", { record: topic({ question: "q" }) }),
      btwDelta("t1", "par"),
      { kind: "exit", code: 1 },
    ]);
    const { pool, id, mirror } = await start(fixture);
    await pool.askBtw(id, "q");
    await vi.waitFor(() => expect(mirror()[0]?.status).toBe("interrupted"));
    expect(mirror()[0]?.answer).toBe("par");
    expect(await pool.getBtw(id)).toMatchObject([{ status: "interrupted", answer: "par" }]);
  });
});
