// 任务池 + TSP 任务的旁路提问（/btw）：askBtw / cancelBtw / getBtw 经 TspRunner 发给 omp，btw 事件推给渲染进程。
// 进程是 test/fake-omp/fake-tsp-omp.ts 回放 omp 18.12.5 的真实录制 fixtures/tsp/btw.jsonl（主轮运行中提问 pong → 再问 ping →
// 追问第一个话题 → 取消一个长回答）：假 omp 只在收到和录制逐字相同的事件后才往下放帧，所以流程能走完就证明事件发对了。
// 磁盘上的话题（btw-history/entry-*.json）由测试在假 omp 收到问题时写，和真实 omp 一样。
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyBtwEvent, isBtwRunning, type BtwHistoryRecord, type BtwUiEvent } from "../src/shared/btw.ts";
import type { ProjectId, StudioSettings, TaskId, TaskState } from "../src/shared/ipc.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeTsp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-tsp-btw-"));
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
  idleClose: "1h",
  reduceMotion: false,
  enterWhileRunning: "steer",
  soundOnDone: false,
  copyOnSelect: true,
  fontSize: 15,
  yoloConfirmed: false,
  backdrop: "theme",
  backdropStrength: "medium",
  customBackdrop: null,
  glass: false,
};

const ids = { pong: "15af3d5a2937f9fd", ping: "15af3d67d7b7f9ff", essay: "15af3d7a2c37fa00" } as const;

interface LogRecord {
  kind: string;
  verb?: string;
  body?: Record<string, unknown>;
}

function readLog(file: string): LogRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as LogRecord);
}

const pools: TaskPool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

async function start(fixture = "btw"): Promise<{
  pool: TaskPool;
  id: TaskId;
  log: string;
  btw: BtwUiEvent[];
  states: TaskState[];
  sessionFile: string;
  watch: () => void;
}> {
  const dir = await mkdtemp(path.join(scratch, "run-"));
  const log = path.join(dir, "omp.log");
  const sessionFile = path.join(dir, "session.jsonl");
  await writeFile(sessionFile, "{}\n");
  const btw: BtwUiEvent[] = [];
  const states: TaskState[] = [];
  const pool = new TaskPool({
    registry: new TaskRegistry(path.join(dir, "tasks.json")),
    getSettings: async () => settings,
    events: {
      state: (state) => states.push(state),
      notice: () => {},
      taskRemoved: () => {},
      btw: (_taskId, event) => btw.push(event),
    },
    listModels: async () => [],
    newTaskDefaults: async () => ({ model: null, thinkingLevel: null, ompDefault: null }),
    tsp: {
      buildLaunch: async (_record, project) => ({
        command: process.execPath,
        args: [fakeTsp, fixture, "--speed=100", `--log=${log}`],
        cwd: project.path,
        env: { ...process.env, FAKE_TSP_SESSION_FILE: sessionFile },
      }),
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
  const created = await pool.createTask({ projectId: project.id as ProjectId });
  const until = async (predicate: (state: TaskState) => boolean): Promise<void> => {
    const deadline = Date.now() + 20_000;
    while (!states.some((state) => state.id === created.id && predicate(state))) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the task state");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  await until((state) => state.status === "idle");
  // 假 omp 收到 `/btw <问题>` 时（收件记录里出现它）把这个话题写进磁盘。
  const written = new Set<string>();
  const entries: Record<string, { id: string; answer: string; status: string }> = {
    "/btw Reply with exactly the word: pong": { id: ids.pong, answer: "pong", status: "complete" },
    "/btw Reply with exactly the word: ping": { id: ids.ping, answer: "ping", status: "complete" },
    // 长回答最后被取消：磁盘上是 omp 收尾后的样子。
    "/btw Write a 400 word essay about trees.": { id: ids.essay, answer: "# Trees", status: "cancelled" },
  };
  const watch = () => {
    const timer = setInterval(() => {
      for (const record of readLog(log)) {
        const text = record.body?.["text"];
        const entry = typeof text === "string" ? entries[text] : undefined;
        if (record.body?.["ev"] !== "send" || !entry || typeof text !== "string" || written.has(entry.id)) continue;
        written.add(entry.id);
        const history = path.join(dir, "session", "btw-history");
        const now = Date.now();
        void mkdir(history, { recursive: true }).then(() =>
          writeFile(
            path.join(history, `entry-${entry.id}.json`),
            JSON.stringify({
              question: text.slice(5),
              answer: entry.answer,
              status: entry.status,
              createdAt: now,
              updatedAt: now,
              id: entry.id,
              leafId: "leaf",
            }),
          ),
        );
      }
    }, 10);
    timer.unref();
  };
  return { pool, id: created.id, log, btw, states, sessionFile, watch };
}

describe("TaskPool · TSP 任务的 /btw（btw.jsonl，假 omp 严格回放）", () => {
  it("askBtw 经主输入框发 /btw，答案作为 btw 事件流回来；追问、取消、getBtw 都走同一条路", async () => {
    const run = await start();
    run.watch();
    // 录制里的第一个用户操作是主轮的一句话：omp 在流式输出时提问。
    await run.pool.sendPrompt(run.id, { text: "Write a 60 word note about rivers. No tools.", whenBusy: "steer" });

    // askBtw 在 omp 开始回答后就返回；面板在回答期间不让再问（omp 也拒绝），所以每次等这一问收尾再问下一个。
    const settled = async (): Promise<void> => {
      const deadline = Date.now() + 10_000;
      while (isBtwRunning(await run.pool.getBtw(run.id))) {
        if (Date.now() > deadline) throw new Error("the side question never finished");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    expect(await run.pool.askBtw(run.id, "Reply with exactly the word: pong")).toBe(ids.pong);
    await settled();
    expect(await run.pool.askBtw(run.id, "Reply with exactly the word: ping")).toBe(ids.ping);
    await settled();
    expect(await run.pool.askBtw(run.id, "Say gamma", ids.pong)).toBe(ids.pong);
    await settled();
    expect(await run.pool.askBtw(run.id, "Write a 400 word essay about trees.")).toBe(ids.essay);

    const running = await run.pool.getBtw(run.id);
    expect(isBtwRunning(running)).toBe(true);
    expect(running.map((record) => record.id)).toEqual([ids.essay, ids.ping, ids.pong]);
    await expect(run.pool.askBtw(run.id, "another")).rejects.toThrow("still running");
    expect(await run.pool.cancelBtw(run.id)).toBe(true);

    // 取消后：镜像里是 cancelled，omp 的弹窗已被关掉（假 omp 收到了录制里的 close）。
    const deadline = Date.now() + 10_000;
    let records: BtwHistoryRecord[] = [];
    do {
      records = await run.pool.getBtw(run.id);
      if (!isBtwRunning(records) && readLog(run.log).filter((r) => r.body?.["act"] === "close").length === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    expect(records.map((record) => [record.id, record.followUps?.length ?? 0])).toEqual([
      [ids.essay, 0],
      [ids.ping, 0],
      [ids.pong, 1],
    ]);
    expect(records[0]!.status).toBe("cancelled");
    expect(records[2]!.followUps![0]).toMatchObject({ question: "Say gamma", answer: "gamma", status: "complete" });

    // 渲染进程按推送的事件推进，得到同一份话题（delta 不带 updatedAt，比较时不算）。
    const strip = (list: readonly BtwHistoryRecord[]): unknown =>
      JSON.parse(
        JSON.stringify(list, (key, value: unknown) => (key === "updatedAt" || key === "createdAt" ? 0 : value)),
      );
    const projected = run.btw.reduce<readonly BtwHistoryRecord[]>((list, event) => applyBtwEvent(list, event), []);
    expect(strip(projected)).toEqual(strip(records));

    // 假 omp 收到的事件：发 /btw 的是主输入框（sf s:1），其余是对弹窗的 action / select / edit。
    const received = readLog(run.log).filter((record) => record.verb === "e" && record.body?.["ev"] !== "ack");
    expect(received.map((record) => record.body?.["act"] ?? record.body?.["ev"])).toEqual([
      "send",
      "send",
      "close",
      "send",
      "close",
      "send",
      "select",
      "follow-up",
      "edit",
      "send",
      "close",
      "send",
      "stop",
      "close",
    ]);
  }, 60_000);

  it("会话文件旁边的 btw-history 就是历史：读会话文件旁边的 btw-history（没问过的任务是空）", async () => {
    const run = await start();
    const history = path.join(path.dirname(run.sessionFile), "session", "btw-history");
    await mkdir(history, { recursive: true });
    await writeFile(
      path.join(history, `entry-${ids.ping}.json`),
      JSON.stringify({
        question: "q",
        answer: "a",
        status: "complete",
        createdAt: 1,
        updatedAt: 2,
        id: ids.ping,
        leafId: null,
      }),
    );
    // 假 omp 在回放开始时用 OSC 报会话文件；任务知道它之前读不到（等到读到为止）。
    let records = await run.pool.getBtw(run.id);
    for (const deadline = Date.now() + 10_000; records.length === 0 && Date.now() < deadline;) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      records = await run.pool.getBtw(run.id);
    }
    expect(records.map((record) => [record.id, record.question, record.status])).toEqual([[ids.ping, "q", "complete"]]);
  }, 60_000);

  it("停止：回答中的旁路提问先 stop、再 close、等弹窗撤掉，之后才给主轮发 Esc（btw-stop.jsonl：真实 omp 里这样 Esc 才停得了主轮）", async () => {
    const run = await start("btw-stop");
    await run.pool.sendPrompt(run.id, { text: "Write a 700 word essay about rivers. No tools.", whenBusy: "steer" });
    await run.pool.askBtw(run.id, "Write a 400 word essay about trees.");
    await run.pool.stopTask(run.id);
    const deadline = Date.now() + 10_000;
    let sequence: string[] = [];
    do {
      sequence = readLog(run.log)
        .filter((record) => record.kind === "keys" || (record.verb === "e" && record.body?.["ev"] !== "ack"))
        .map((record) => (record.kind === "keys" ? "ESC" : String(record.body?.["act"] ?? record.body?.["ev"])));
      if (sequence.includes("ESC")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    // Esc 在 close 之后（弹窗撤掉之后）。
    expect(sequence).toEqual(["send", "send", "stop", "close", "ESC"]);
  }, 60_000);
});
