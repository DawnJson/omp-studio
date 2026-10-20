// get_state 里的 fast / slow、超限、输出速度进 TaskState；setTaskFastMode / setTaskSlowMode 发 RPC，失败时把 omp 的原文抛出来。
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
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio speed-"));
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
  copyOnSelect: true,
  taskEngine: "rpc",
  yoloConfirmed: false,
};

type Entry = Record<string, unknown>;
interface RecordedLine extends Entry {
  frame?: { type?: string; command?: string; data?: Record<string, unknown> };
}

/** 握手取 simple-reply 录制里 prompt 之前的条目；握手里的 get_state 应答并入 `state`（它也是之后所有 get_state 的回放内容）。 */
async function fixtureWith(state: Record<string, unknown>, tail: Entry[]): Promise<string> {
  const lines = (await readFile(path.join(root, "fixtures", "rpc", "simple-reply.ndjson"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line): RecordedLine => JSON.parse(line));
  const promptAt = lines.findIndex((entry) => entry.frame?.type === "prompt");
  const head = lines.slice(0, promptAt).map((entry): RecordedLine => {
    const frame = entry.frame;
    if (entry.kind === "out" && frame?.type === "response" && frame.command === "get_state") {
      const data = { ...frame.data, ...state };
      for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
      return { ...entry, frame: { ...frame, data } };
    }
    return entry;
  });
  const file = path.join(await mkdtemp(path.join(scratch, "fx-")), "speed.ndjson");
  await writeFile(file, [...head, ...tail, { kind: "hang" }].map((entry) => JSON.stringify(entry)).join("\n"));
  return file;
}

const pools: TaskPool[] = [];
async function start(fixture: string): Promise<{ pool: TaskPool; id: TaskId; inputLog: string; latest(): TaskState }> {
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
  const latest = () => {
    const state = states.findLast((s) => s.id === created.id);
    if (!state) throw new Error("no state yet");
    return state;
  };
  await vi.waitFor(() => expect(latest().status).toBe("idle"), { timeout: 15_000 });
  return { pool, id: created.id, inputLog, latest };
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

const sent = async (inputLog: string): Promise<{ type: string; enabled?: boolean }[]> =>
  (await readFile(inputLog, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line): { type: string; enabled?: boolean } => JSON.parse(line));

describe("get_state → TaskState", () => {
  it("握手后带上 fast / slow / usageLimit / tokensPerSecond", async () => {
    const fixture = await fixtureWith(
      {
        fastModeEnabled: true,
        fastModeActive: true,
        slowModeSupported: true,
        slowModeEnabled: true,
        slowModeScope: "global",
        usageLimit: { stage: "low_priority", resetsAtSec: 1_800_000_000, allowanceLeftPercent: 40 },
        tokensPerSecond: 88.5,
      },
      [],
    );
    const { latest } = await start(fixture);
    expect(latest()).toMatchObject({
      fastMode: { enabled: true, active: true },
      slowMode: { supported: true, enabled: true, scope: "global" },
      usageLimit: { stage: "low_priority", resetsAtSec: 1_800_000_000, allowanceLeftPercent: 40 },
      tokensPerSecond: 88.5,
    });
  });

  it("omp 没给这些字段时是关 / 不支持 / null", async () => {
    const { latest } = await start(
      await fixtureWith(
        {
          fastModeEnabled: undefined,
          fastModeActive: undefined,
          slowModeSupported: undefined,
          slowModeEnabled: undefined,
          usageLimit: undefined,
          tokensPerSecond: undefined,
        },
        [],
      ),
    );
    expect(latest()).toMatchObject({
      fastMode: { enabled: false, active: false },
      slowMode: { supported: false, enabled: false, scope: null },
      usageLimit: null,
      tokensPerSecond: null,
    });
  });
});

describe("setTaskFastMode / setTaskSlowMode", () => {
  it("发 set_fast_mode / set_slow_mode，参数是布尔值", async () => {
    const fixture = await fixtureWith({ slowModeSupported: true, slowModeScope: "global" }, [
      { kind: "in", frame: { type: "set_fast_mode", enabled: true, id: "f1" } },
      {
        kind: "out",
        frame: {
          id: "f1",
          type: "response",
          command: "set_fast_mode",
          success: true,
          data: { enabled: true, active: true },
        },
      },
      { kind: "in", frame: { type: "set_slow_mode", enabled: true, id: "s1" } },
      {
        kind: "out",
        frame: { id: "s1", type: "response", command: "set_slow_mode", success: true, data: { enabled: true } },
      },
    ]);
    const { pool, id, inputLog } = await start(fixture);
    await pool.setTaskFastMode(id, true);
    await pool.setTaskSlowMode(id, true);
    const frames = await sent(inputLog);
    expect(frames.find((frame) => frame.type === "set_fast_mode")?.enabled).toBe(true);
    expect(frames.find((frame) => frame.type === "set_slow_mode")?.enabled).toBe(true);
  });

  it("模型不支持时 omp 的原文抛给调用方", async () => {
    const fixture = await fixtureWith({}, [
      { kind: "in", frame: { type: "set_fast_mode", enabled: true, id: "f1" } },
      {
        kind: "out",
        frame: {
          id: "f1",
          type: "response",
          command: "set_fast_mode",
          success: false,
          error: "Fast mode is unavailable for the current model.",
        },
      },
    ]);
    const { pool, id } = await start(fixture);
    await expect(pool.setTaskFastMode(id, true)).rejects.toThrow(/Fast mode is unavailable/);
  });
});
