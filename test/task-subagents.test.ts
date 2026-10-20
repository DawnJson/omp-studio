// 子代理泳道的主进程侧：用 fake-omp 回放真实录制（fixtures/rpc/subagents-*.ndjson），经任务池检查
// 聚合出的泳道、详情（get_subagent_messages）、steer / cancel 的校验和透传。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StudioSettings, TaskId } from "../src/shared/ipc.ts";
import type { SubagentLane } from "../src/shared/subagents.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const fixture = (name: string) => path.join(root, "fixtures", "rpc", `${name}.ndjson`);
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 子代理-"));
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

const pools: TaskPool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

/** 起一个任务池，让它回放 fixtureFile；返回 pool、任务 id 和"等泳道满足条件"。 */
async function start(fixtureFile: string) {
  const snapshots: SubagentLane[][] = [];
  const idle = Promise.withResolvers<void>();
  let waiters: { predicate: (lanes: SubagentLane[]) => boolean; resolve: () => void }[] = [];
  const pool = new TaskPool({
    registry: new TaskRegistry(path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json")),
    getSettings: async () => settings,
    buildLaunch: async (_record, project) => ({
      command: process.execPath,
      args: [fakeOmp, fixtureFile],
      cwd: project.path,
      env: process.env,
    }),
    assignJob: () => {},
    events: {
      state: (state) => {
        if (state.status === "idle") idle.resolve();
      },
      transcript: () => {},
      notice: () => {},
      taskRemoved: () => {},
      slashCommands: () => {},
      subagents: (_taskId, lanes) => {
        snapshots.push(lanes);
        waiters = waiters.filter((waiter) => (waiter.predicate(lanes) ? (waiter.resolve(), false) : true));
      },
    },
  });
  pools.push(pool);
  await pool.init();
  const project = await pool.ensureProject(projectDir);
  const created = await pool.createTask({ projectId: project.id });
  await idle.promise;
  await pool.sendPrompt(created.id, { text: "go", whenBusy: "steer" });
  const lanesWhere = (predicate: (lanes: SubagentLane[]) => boolean): Promise<void> => {
    const last = snapshots.at(-1);
    if (last && predicate(last)) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    waiters.push({ predicate, resolve });
    return promise;
  };
  return { pool, id: created.id as TaskId, snapshots, lanesWhere };
}

describe("任务池：子代理泳道（回放 subagents-control）", () => {
  it("泳道事件带着聚合结果；终态之后详情读得到完整记录；已结束的子代理不能 steer / cancel", async () => {
    const h = await start(fixture("subagents-control"));
    await h.lanesWhere(
      (lanes) => lanes.length === 3 && lanes.every((lane) => lane.status !== "running" && lane.endedAt !== null),
    );
    const lanes = h.pool.getSubagents(h.id);
    expect(lanes.map((l) => [l.id, l.status])).toEqual([
      ["ReadAlpha", "completed"],
      ["ReadBeta", "aborted"],
      ["ReadBetaRetry", "completed"],
    ]);
    expect(h.pool.getSubagents(h.id)).toEqual(h.snapshots.at(-1));

    const detail = await h.pool.getSubagentDetail(h.id, "ReadAlpha");
    expect(detail).toMatchObject({ unavailable: null, truncated: false, error: null });
    expect(detail.messages?.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "toolResult",
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(detail.lane.id).toBe("ReadAlpha");
    // 带上已有条数（since）只返回新增的：这里没有新增。
    const again = await h.pool.getSubagentDetail(h.id, "ReadAlpha", 8);
    expect(again).toMatchObject({ messages: [], from: 8, total: 8 });

    await expect(h.pool.getSubagentDetail(h.id, "Nope")).rejects.toThrow(/unknown subagent/);
    await expect(h.pool.steerSubagent(h.id, "ReadAlpha", "hi")).rejects.toThrow(/not running/);
    await expect(h.pool.cancelSubagent(h.id, "ReadBeta")).rejects.toThrow(/not running/);
    await expect(h.pool.steerSubagent(h.id, "Nope", "hi")).rejects.toThrow(/not running/);
  });
});

describe("任务池：运行中的子代理（回放 subagents-parallel，截到两个都在跑时挂起）", () => {
  async function runningFixture(): Promise<string> {
    const raw = (await readFile(fixture("subagents-parallel"), "utf8")).split("\n").filter(Boolean);
    // 第一条 BetaSummarizer 的 toolCount≥1 的 progress：两个子代理都已 started，都还在跑。
    const cut = raw.findIndex((line) => {
      const frame = (
        JSON.parse(line) as { frame?: { type?: string; payload?: { progress?: Record<string, unknown> } } }
      ).frame;
      return (
        frame?.type === "subagent_progress" &&
        frame.payload?.progress?.["id"] === "BetaSummarizer" &&
        Number(frame.payload.progress["toolCount"]) >= 1
      );
    });
    expect(cut).toBeGreaterThan(0);
    const file = path.join(scratch, "running.ndjson");
    // 截掉的尾部里 get_subagent_messages 的 in/out 要留着：fake-omp 靠它们回详情，它们不占回放顺序。
    const records = raw.slice(cut + 1).filter((line) => line.includes("get_subagent_messages"));
    await writeFile(file, [...raw.slice(0, cut + 1), ...records, JSON.stringify({ kind: "hang" })].join("\n") + "\n");
    return file;
  }

  it("两个子代理并行在跑：runningSubagents 计数、泳道数据、steer / cancel 透传并返回 omp 的结果", async () => {
    const h = await start(await runningFixture());
    await h.lanesWhere((lanes) => lanes.some((l) => l.id === "BetaSummarizer" && l.toolCount >= 1));
    const lanes = h.pool.getSubagents(h.id);
    expect(lanes.map((l) => [l.id, l.status])).toEqual([
      ["AlphaReader", "running"],
      ["BetaSummarizer", "running"],
    ]);
    expect(lanes[1]).toMatchObject({ model: "deepseek/deepseek-v4-flash", detached: true });
    expect(h.pool.listTasks().find((t) => t.id === h.id)?.runningSubagents).toBe(2);

    await expect(h.pool.steerSubagent(h.id, "AlphaReader", "also say hi")).resolves.toBeUndefined();
    await expect(h.pool.cancelSubagent(h.id, "BetaSummarizer")).resolves.toBe(true);

    // 运行中的子代理也能读到记录（fake-omp 回的是录制里那个子代理结束时的记录）。
    const detail = await h.pool.getSubagentDetail(h.id, "AlphaReader");
    expect(detail.unavailable).toBeNull();
    expect(detail.messages?.length).toBeGreaterThan(0);
  });
});
