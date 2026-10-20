// 任务池 + TSP 任务：设置定引擎、TspRunner 的生命周期和状态推导、会话文件和标题、只有 rpc 才有的操作被拒。
// 进程是 test/fake-omp/fake-tsp-omp.ts（伪终端里回放 fixtures/tsp 的录制），rpc 任务是 fake-omp.ts。
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  ModelOption,
  ProjectId,
  StudioSettings,
  TaskEngine,
  TaskId,
  TaskState,
  TspBatch,
} from "../src/shared/ipc.ts";
import type { TspEvent } from "../src/shared/tsp/tsp.generated.ts";
import { applyMessage, createDocument, restoreDocument, snapshotDocument } from "../src/shared/tsp/document.ts";
import { titleFromPrompt } from "../src/main/tasks/convert.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";
import { loadTspFixture, recordedUserEvents } from "./tsp-fixtures.ts";

/** approval 录制里用户的两个操作：发的那句话、点 Approve。 */
function approvalEvents(): { text: string; approve: TspEvent } {
  const [send, approve] = recordedUserEvents(loadTspFixture("approval")).map(
    (entry) => entry.event as unknown as TspEvent,
  );
  if (send?.ev !== "send" || !approve) throw new Error("unexpected approval fixture");
  return { text: send.text, approve };
}

const root = path.resolve(import.meta.dirname, "..");
const fakeTsp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
const fakeRpc = path.join(root, "test", "fake-omp", "fake-omp.ts");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-tsp-pool-"));
  projectDir = path.join(scratch, "project");
  await mkdir(projectDir);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const settings = (taskEngine: TaskEngine): StudioSettings => ({
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses: 6,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  copyOnSelect: true,
  taskEngine,
  yoloConfirmed: false,
});

const catalog: ModelOption[] = [
  {
    key: { provider: "deepseek", modelId: "deepseek-v4-flash" },
    name: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
    reasoning: true,
    acceptsImages: false,
    maxTokens: null,
    thinkingEfforts: ["low", "medium", "high"],
    cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
  },
];

class Events {
  states: TaskState[] = [];
  tspBatches: TspBatch[] = [];
  #waiters: { predicate: (state: TaskState) => boolean; resolve: (state: TaskState) => void }[] = [];

  readonly sink = {
    state: (state: TaskState) => {
      this.states.push(state);
      this.#waiters = this.#waiters.filter((waiter) =>
        waiter.predicate(state) ? (waiter.resolve(state), false) : true,
      );
    },
    transcript: () => {},
    notice: () => {},
    taskRemoved: () => {},
    slashCommands: () => {},
    subagents: () => {},
    tspBatch: (batch: TspBatch) => this.tspBatches.push(batch),
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
}

interface Harness {
  pool: TaskPool;
  events: Events;
  registry: TaskRegistry;
  tasksFile: string;
  projectId: ProjectId;
  /** 每次起 TSP 进程时任务记录里的会话文件（恢复会话时 omp 用 `--resume` 拿到它）。 */
  launches: Launch[];
  /** 下一次起进程用的录制和环境。 */
  next: { fixture: string; env: Record<string, string> };
  /** 假 omp 的收件记录。 */
  log: string;
  engine: { current: TaskEngine };
}

const pools: TaskPool[] = [];
let counter = 0;

async function harness(tasksFile?: string, engine: TaskEngine = "tsp"): Promise<Harness> {
  counter += 1;
  const events = new Events();
  const file = tasksFile ?? path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json");
  const registry = new TaskRegistry(file);
  const launches: Launch[] = [];
  const log = path.join(scratch, `omp-log-${counter}.jsonl`);
  const next = { fixture: "slash", env: {} as Record<string, string> };
  const current = { current: engine };
  const pool = new TaskPool({
    registry,
    getSettings: async () => settings(current.current),
    buildLaunch: async (_record, project) => ({
      command: process.execPath,
      args: [fakeRpc, path.join(root, "fixtures", "rpc", "simple-reply.ndjson")],
      cwd: project.path,
      env: process.env,
    }),
    assignJob: () => {},
    events: events.sink,
    listModels: async () => catalog,
    newTaskDefaults: async () => ({
      model: "deepseek/deepseek-v4-flash:high",
      thinkingLevel: "high",
      ompDefault: null,
    }),
    tsp: {
      buildLaunch: async (record, project) => {
        launches.push({ sessionFile: record.sessionFile });
        return {
          command: process.execPath,
          args: [fakeTsp, next.fixture, "--speed=100", `--log=${log}`],
          cwd: record.worktreePath ?? project.path,
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
  return { pool, events, registry, tasksFile: file, projectId: project.id, launches, next, log, engine: current };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

type LogRecord = { kind: string; verb?: string; body?: Record<string, unknown>; data?: string };
async function waitForLog(file: string, predicate: (records: LogRecord[]) => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const records = existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as LogRecord)
      : [];
    if (predicate(records)) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for the fake omp's log");
    // 假 omp 在另一个进程里，它的收件记录只能轮询文件。
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("任务池：按设置的引擎建 runner", () => {
  it("TSP 任务：starting → idle → running → needs_you（审批门）→ running → idle，节点树和批次一致", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = "approval";
    const created = await h.pool.createTask({ projectId: h.projectId });
    expect(created).toMatchObject({ engine: "tsp", status: "starting", title: "" });
    expect(h.registry.findTask(created.id)?.engine).toBe("tsp");
    await h.events.until(created.id, (state) => state.status === "idle");

    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    const waiting = await h.events.until(created.id, (state) => state.status === "needs_you");
    // GateNotifier 靠 dialogs[0] 发"等你确认"通知：标题是审批门的标题。
    expect(waiting.dialogs[0]).toMatchObject({ kind: "confirm", title: "Allow tool: bash" });
    expect(typeof waiting.runStartedAt).toBe("number");

    h.pool.sendTspEvent(created.id, events.approve);
    const done = await h.events.until(
      created.id,
      (state) => state.status === "idle" && state.lastTurn?.status === "completed",
    );
    expect(h.events.statuses(created.id)).toEqual(["starting", "idle", "running", "needs_you", "running", "idle"]);
    expect(done.runStartedAt).toBeNull();
    expect(done.dialogs).toEqual([]);
    // 草稿的第一句话成了标题（omp 的标题 OSC 之后会替换它）。
    expect(done.title).toBe(titleFromPrompt(events.text));
    // 发消息和一轮结束都记为活动：时间落盘，等于这一轮的结束时间；标题、会话文件等记账写入不动它。
    expect(done.updatedAt).toBe(done.lastTurn?.endedAt);
    expect(h.registry.findTask(created.id)?.updatedAt).toBe(done.updatedAt);
    expect(waiting.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    // 推送的批次序号连续，增量重建的文档等于主进程的快照。
    const snapshot = h.pool.getTspSnapshot(created.id);
    const batches = h.events.tspBatches.filter((batch) => batch.taskId === created.id);
    let seq = 0;
    const rebuilt = createDocument();
    for (const batch of batches) {
      expect(batch.firstSeq).toBe(seq + 1);
      seq += batch.messages.length;
      for (const message of batch.messages) applyMessage(rebuilt, message);
    }
    expect(snapshot.seq).toBe(seq);
    expect(snapshot.document).toEqual(snapshotDocument(rebuilt));
    expect([...restoreDocument(snapshot.document).surfaces.keys()]).toEqual(["s:1"]);
  }, 60_000);

  it("停止 = 发 Esc；停止过的这一轮结局记为 aborted", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = "approval";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    await h.events.until(created.id, (state) => state.status === "needs_you");

    const restored = await h.pool.stopTask(created.id);
    expect(restored).toMatchObject({ steering: [], followUp: [], aborted: true });
    await waitForLog(h.log, (records) => records.some((record) => record.kind === "keys" && record.data === "\x1b"));

    h.pool.sendTspEvent(created.id, events.approve);
    const done = await h.events.until(created.id, (state) => state.status === "idle" && state.lastTurn !== null);
    expect(done.lastTurn?.status).toBe("aborted");
  }, 60_000);

  it("omp 的会话文件落盘后才记进任务（没落盘的不记），标题跟着 omp，重启后用记录里的会话文件恢复", async () => {
    const sessionFile = path.join(scratch, "sessions 一", "a.jsonl");
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(sessionFile, "{}\n");
    const h = await harness();
    h.next.env = { FAKE_TSP_SESSION_FILE: sessionFile, FAKE_TSP_TITLE: "\u{f1821} 修复 登录 bug" };
    const first = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(first.id, (state) => state.status === "idle");
    const saved = await h.events.until(
      first.id,
      (state) => state.title === "修复 登录 bug" && h.registry.findTask(first.id)?.sessionFile === sessionFile,
    );
    expect(saved.title).toBe("修复 登录 bug");

    // 文件还不存在（omp 在第一条回复之后才写）：不记，否则下次恢复会失败。
    h.next.env = { FAKE_TSP_SESSION_FILE: path.join(scratch, "sessions 一", "not-yet.jsonl") };
    const second = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(second.id, (state) => state.status === "idle");
    await h.pool.archiveTask(second.id);
    expect(h.registry.findTask(second.id)?.sessionFile).toBeNull();

    // "重启应用"：同一份 tasks.json，打开任务时按记录里的会话文件起进程。
    await h.pool.shutdown();
    const again = await harness(h.tasksFile);
    again.next.fixture = "slash";
    expect(again.pool.listTasks().map((state) => [state.engine, state.status])).toEqual([["tsp", "stopped"]]);
    await again.pool.openTask(first.id);
    expect(again.launches).toEqual([{ sessionFile }]);
  }, 60_000);

  it("只有 rpc 才有的操作对 TSP 任务报明确的错误；带图片的 prompt 走 @ 提及", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    expect(() => h.pool.getSubagents(created.id)).toThrow(/TSP engine/);
    expect(() => h.pool.compactTask(created.id)).toThrow(/TSP engine/);
    await expect(h.pool.forkTask(created.id, null)).rejects.toThrow(/TSP engine/);
    // TSP 任务也有模型目录（listTaskModels 不再是 rpc 专有）。
    await expect(h.pool.listTaskModels(created.id)).resolves.toEqual(catalog);
    // 图片没有 TSP 通道：落成临时文件，用 omp 的 `@"路径"` 提及发出去。
    await h.pool.sendPrompt(created.id, {
      text: "看图",
      images: [{ mimeType: "image/png", data: "AA==" }],
      whenBusy: "steer",
    });
    let sent = "";
    await waitForLog(h.log, (records) => {
      const record = records.find((r) => r.verb === "e" && r.body?.["ev"] === "send");
      sent = String(record?.body?.["text"] ?? "");
      return record !== undefined;
    });
    const staged = /^看图 @"(.+\.png)"$/.exec(sent)?.[1];
    expect(staged).toBeTruthy();
    expect(readFileSync(staged!)).toEqual(Buffer.from([0]));
    // 对话流不是 TSP 任务的东西：给空的。
    expect(h.pool.getTranscript(created.id).transcript.items).toEqual([]);
  }, 60_000);

  it("引擎在创建时定下：改设置不影响已有任务，TSP 任务的 tspSnapshot 对 rpc 任务报错", async () => {
    const h = await harness();
    const tspTask = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(tspTask.id, (state) => state.status === "idle");

    h.engine.current = "rpc";
    const rpcTask = await h.pool.createTask({ projectId: h.projectId });
    expect(rpcTask.engine).toBe("rpc");
    await h.events.until(rpcTask.id, (state) => state.status === "idle");
    expect(h.registry.findTask(tspTask.id)?.engine).toBe("tsp");
    expect(h.registry.findTask(rpcTask.id)?.engine).toBe("rpc");
    expect(() => h.pool.getTspSnapshot(rpcTask.id)).toThrow(/does not run on the TSP engine/);
    expect(h.pool.listTasks().find((state) => state.id === tspTask.id)?.engine).toBe("tsp");
  }, 60_000);

  it("omp 还没起来时 resizeTsp 不报错，列数记下来，进程起来就用它", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    // 首发时渲染进程在 omp 进程起来之前就量好了列宽
    expect(() => h.pool.resizeTsp(created.id, 63)).not.toThrow();
    await waitForLog(h.log, (records) =>
      records.some((record) => record.kind === "tsp" && record.verb === "r" && record.body?.["cols"] === 63),
    );
  }, 60_000);
});

const flashKey = { provider: "deepseek", modelId: "deepseek-v4-flash" };

describe("TSP 任务：输入框状态、切模型、提问时的发送", () => {
  it("输入框卡片出现之前 TaskState 就是 omp 的默认模型和思考强度（不传 --model）", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    const first = h.events.states.find((s) => s.id === created.id && s.model !== null);
    expect(first).toMatchObject({ status: "starting", thinkingLevel: "high" });
    expect(first?.model).toEqual(catalog[0]);
    expect(h.launches[0]?.sessionFile).toBeNull();
    expect(h.registry.findTask(created.id)?.model).toBeNull();
  }, 60_000);

  it("输入框出现后 TaskState 有模型（名字对上目录）、思考强度、上下文和费用；listTaskModels 给目录", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    const state = await h.events.until(
      created.id,
      (s) => s.model?.key.provider === "deepseek" && s.contextUsage !== null,
    );
    expect(state.model).toEqual(catalog[0]);
    expect(state.thinkingLevel).toBe("high");
    expect(state.thinkingLevels).toEqual(["off", "low", "medium", "high"]);
    expect(state.contextUsage?.contextWindow).toBe(1_000_000);
    expect(state.sessionUsage?.cost).toBe(0);
    expect(await h.pool.listTaskModels(created.id)).toEqual(catalog);
    // 和 rpc 一样记进任务记录。
    await vi.waitFor(() =>
      expect(h.registry.findTask(created.id)).toMatchObject({ model: flashKey, thinkingLevel: "high" }),
    );
  }, 60_000);

  it("setTaskModel：点模型胶囊、在选择器里 activate 那一项，omp 确认后 resolve", async () => {
    const h = await harness();
    h.next.fixture = "picker";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.model !== null);
    await h.pool.setTaskModel(created.id, flashKey);
    await waitForLog(h.log, (records) =>
      records.some(
        (record) => record.verb === "e" && record.body?.["ev"] === "action" && record.body?.["act"] === "status.model",
      ),
    );
  }, 60_000);

  it("setTaskModel：选择器里没有的模型立刻报错并关掉选择器", async () => {
    const h = await harness();
    h.next.fixture = "picker";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.model !== null);
    await expect(h.pool.setTaskModel(created.id, { provider: "x", modelId: "nope" })).rejects.toThrow(/not available/);
    await waitForLog(h.log, (records) => records.some((record) => record.kind === "keys" && record.data === "\x1b"));
  }, 60_000);

  it("提问/审批替换了输入框：sendPrompt 和切模型立刻 reject（composer_unavailable），不等超时", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = "approval";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    await h.events.until(created.id, (s) => s.status === "needs_you");
    const started = Date.now();
    await expect(h.pool.sendPrompt(created.id, { text: "再说一句", whenBusy: "steer" })).rejects.toThrow(
      /composer_unavailable/,
    );
    await expect(h.pool.setTaskModel(created.id, flashKey)).rejects.toThrow(/composer_unavailable/);
    await expect(h.pool.setTaskThinkingLevel(created.id, "low")).rejects.toThrow(/composer_unavailable/);
    expect(Date.now() - started).toBeLessThan(5_000);
    // 输入框上显示过的值在被替换的那几帧里保留。
    expect(h.pool.listTasks().find((s) => s.id === created.id)?.model).toEqual(catalog[0]);
  }, 60_000);
});

describe("引擎统一：设置是 tsp 时，没在运行的 rpc 老任务下次启动改用 TSP", () => {
  const sessionFile = () => path.join(scratch, "sessions 二", "old.jsonl");

  it("应用启动时：记录里的 rpc 任务改成 tsp（落盘），用 --resume=<会话文件> 起", async () => {
    const old = await harness(undefined, "rpc");
    const created = await old.pool.createTask({ projectId: old.projectId });
    await old.events.until(created.id, (s) => s.status === "idle");
    await old.registry.updateTask(created.id, { sessionFile: sessionFile() });
    await old.pool.shutdown();

    const again = await harness(old.tasksFile, "tsp");
    expect(again.registry.findTask(created.id)?.engine).toBe("tsp");
    expect(again.pool.listTasks().map((s) => [s.engine, s.status])).toEqual([["tsp", "stopped"]]);
    await again.pool.openTask(created.id);
    expect(again.launches).toEqual([{ sessionFile: sessionFile() }]);
  }, 60_000);

  it("引擎迁移只改 engine，不动任务时间", async () => {
    const old = await harness(undefined, "rpc");
    const created = await old.pool.createTask({ projectId: old.projectId });
    await old.events.until(created.id, (s) => s.status === "idle");
    const stamped = Date.UTC(2026, 9, 1);
    await old.registry.updateTask(created.id, { sessionFile: sessionFile(), updatedAt: stamped });
    await old.pool.shutdown();

    const again = await harness(old.tasksFile, "tsp");
    expect(again.registry.findTask(created.id)).toMatchObject({ engine: "tsp", updatedAt: stamped });
    expect(again.pool.listTasks()[0]?.updatedAt).toBe(stamped);
    await again.pool.openTask(created.id);
    await again.events.until(created.id, (s) => s.status === "idle");
    expect(again.pool.listTasks()[0]?.updatedAt).toBe(stamped);
    expect(again.registry.findTask(created.id)?.updatedAt).toBe(stamped);
  }, 60_000);

  it("设置在运行期间改成 tsp：运行中的 rpc 任务不动，停下后下次启动才换；没有会话文件就是新会话", async () => {
    const h = await harness(undefined, "rpc");
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    h.engine.current = "tsp";
    await h.pool.openTask(created.id);
    expect(h.pool.listTasks()[0]?.engine).toBe("rpc");
    expect(h.registry.findTask(created.id)?.engine).toBe("rpc");

    await h.pool.shutdown();
    const again = await harness(h.tasksFile, "rpc");
    expect(again.pool.listTasks()[0]?.engine).toBe("rpc");
    again.engine.current = "tsp";
    await again.pool.openTask(created.id);
    expect(again.pool.listTasks()[0]?.engine).toBe("tsp");
    expect(again.registry.findTask(created.id)?.engine).toBe("tsp");
    expect(again.launches).toEqual([{ sessionFile: null }]);
  }, 60_000);

  it("设置是 rpc 时老任务照旧", async () => {
    const old = await harness(undefined, "rpc");
    const created = await old.pool.createTask({ projectId: old.projectId });
    await old.events.until(created.id, (s) => s.status === "idle");
    await old.pool.shutdown();
    const again = await harness(old.tasksFile, "rpc");
    await again.pool.openTask(created.id);
    expect(again.pool.listTasks()[0]?.engine).toBe("rpc");
    expect(again.launches).toEqual([]);
  }, 60_000);
});
