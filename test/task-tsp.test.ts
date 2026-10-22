// 任务池 + TSP 任务：TspRunner 的生命周期和状态推导、会话文件和标题、老 rpc 任务的迁移。
// 进程是 test/fake-omp/fake-tsp-omp.ts（伪终端里回放 fixtures/tsp 的录制）。
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelOption, ProjectId, StudioSettings, TaskId, TaskState, TspBatch } from "../src/shared/ipc.ts";
import type { TspEvent } from "../src/shared/tsp/tsp.generated.ts";
import { applyMessage, createDocument, restoreDocument, snapshotDocument } from "../src/shared/tsp/document.ts";
import { titleFromPrompt } from "../src/main/tasks/convert.ts";
import { TaskPool, type PoolDeps } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";
import { findAgentHub, findFocus, listAgents } from "../src/shared/tsp/agent-hub.ts";
import { findMessageTarget } from "../src/shared/tsp/gate.ts";
import { hasQueuedMessages } from "../src/shared/tsp/queue-restore.ts";
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

const settings = (): StudioSettings => ({
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses: 6,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  copyOnSelect: true,
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
    intelligence: 34.3,
    catalogTps: null,
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
    notice: () => {},
    taskRemoved: () => {},
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
}

const pools: TaskPool[] = [];
let counter = 0;

async function harness(tasksFile?: string, extra: Partial<PoolDeps> = {}): Promise<Harness> {
  counter += 1;
  const events = new Events();
  const file = tasksFile ?? path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json");
  const registry = new TaskRegistry(file);
  const launches: Launch[] = [];
  const log = path.join(scratch, `omp-log-${counter}.jsonl`);
  const next = { fixture: "slash", env: {} as Record<string, string> };
  const pool = new TaskPool({
    registry,
    getSettings: async () => settings(),
    events: events.sink,
    listModels: async () => catalog,
    ...extra,
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
  return { pool, events, registry, tasksFile: file, projectId: project.id, launches, next, log };
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

describe("任务池：TSP 任务", () => {
  it("TSP 任务：starting → idle → running → needs_you（审批门）→ running → idle，节点树和批次一致", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = "approval";
    const created = await h.pool.createTask({ projectId: h.projectId });
    expect(created).toMatchObject({ status: "starting", title: "" });
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

  it("运行中排队了一条消息再停止：omp 写回它输入框的排队文字交还给调用方，omp 的输入框被清空", async () => {
    const [first, queued] = recordedUserEvents(loadTspFixture("queue-esc")).filter(
      (entry) => entry.event["ev"] === "send",
    );
    if (!first || !queued) throw new Error("unexpected queue-esc fixture");
    const h = await harness();
    h.next.fixture = "queue-esc";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.pool.sendPrompt(created.id, { text: String(first.event["text"]), whenBusy: "steer" });
    await h.events.until(created.id, (state) => state.status === "running");
    await h.pool.sendPrompt(created.id, { text: String(queued.event["text"]), whenBusy: "steer" });
    // 排队区出现之后再停（Esc 时队列里没有消息就不会等输入框）。
    for (
      let waited = 0;
      !hasQueuedMessages(restoreDocument(h.pool.getTspSnapshot(created.id).document));
      waited += 50
    ) {
      if (waited > 10_000) throw new Error("the queue never showed up");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const restored = await h.pool.stopTask(created.id);
    expect(restored).toMatchObject({ steering: [{ text: queued.event["text"] }], followUp: [], aborted: true });
    await waitForLog(h.log, (records) =>
      records.some((record) => record.kind === "tsp" && record.body?.["ev"] === "edit" && record.body["text"] === ""),
    );
  }, 60_000);

  it("没有排队消息时停止立刻返回，不等 omp 的输入框", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = "approval";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    await h.events.until(created.id, (state) => state.status === "needs_you");
    const started = Date.now();
    await h.pool.stopTask(created.id);
    expect(Date.now() - started).toBeLessThan(1_000);
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
    expect(again.pool.listTasks().map((state) => state.status)).toEqual(["stopped"]);
    await again.pool.openTask(first.id);
    expect(again.launches).toEqual([{ sessionFile }]);
  }, 60_000);

  it("runTaskCommand：TSP 任务把命令文本当 send 发给 omp，返回 omp 的状态 toast（omp 18.12.5 录制 slash-status）", async () => {
    const h = await harness();
    h.next.fixture = "slash-status";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");

    // 录制里 omp 对 /modelpreset list 的回应是 toast "No model presets saved. …"；没给 success 谓词，第一条新 toast 就是结果。
    const preset = await h.pool.runTaskCommand(created.id, { kind: "modelPreset", op: "list" });
    expect(preset.text).toBe("No model presets saved. Use /modelpreset save <name> to create one.");
    // /dirs 的 toast 带工作区目录列表（路径在录制里已脱敏）。
    const dirs = await h.pool.runTaskCommand(created.id, { kind: "dirs" });
    expect(dirs.text).toBe("Workspace directories:\n  C:\\work\\project (working directory)");

    await waitForLog(
      h.log,
      (records) => records.filter((record) => record.verb === "e" && record.body?.["ev"] === "send").length === 2,
    );
    const texts = readFileSync(h.log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as LogRecord)
      .filter((record) => record.body?.["ev"] === "send")
      .map((record) => record.body?.["text"]);
    expect(texts).toEqual(["/modelpreset list", "/dirs"]);
  }, 60_000);

  it("compactTask（TSP）：会话太小时以 omp 的 'Error: Compaction failed…' 原文 reject（omp 18.12.5 录制 compact-error）", async () => {
    const h = await harness();
    h.next.fixture = "compact-error";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await expect(h.pool.compactTask(created.id)).rejects.toThrow(
      "Error: Compaction failed: Nothing to compact (session too small)",
    );
  }, 60_000);

  it("compactTask（TSP）：omp 画出压缩分隔就算成功，没有 toast（omp 18.12.5 录制 compact-ok：两轮对话后 /compact）", async () => {
    const h = await harness();
    h.next.fixture = "compact-ok";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    for (const topic of ["the history of bridges", "how volcanoes form"]) {
      await h.pool.sendPrompt(created.id, { text: `Write about 350 words on ${topic}. No tools.`, whenBusy: "steer" });
      await h.events.until(created.id, (state) => state.status === "idle" && state.lastTurn !== null);
    }
    await expect(h.pool.compactTask(created.id)).resolves.toBeUndefined();
  }, 60_000);

  it("会话开关：omp 的状态 toast 发布成 TaskState.sessionToggles（status-toggles 录制，omp 18.12.5 的原文）", async () => {
    const h = await harness();
    h.next.fixture = "status-toggles";
    const created = await h.pool.createTask({ projectId: h.projectId });
    const idle = await h.events.until(created.id, (state) => state.status === "idle");
    expect(idle.sessionToggles).toEqual({
      skillful: null,
      extendedContext: null,
      computer: null,
      advisor: null,
      browser: null,
      prewalk: null,
    });

    const off = await h.pool.runTaskCommand(created.id, { kind: "toggle", name: "skillful", on: false });
    expect(off.text).toBe("Skill listing disabled for this session.");
    await h.events.until(created.id, (state) => state.sessionToggles.skillful === false);
    await h.pool.runTaskCommand(created.id, { kind: "toggle", name: "extendedContext", on: true });
    await h.pool.runTaskCommand(created.id, { kind: "toggle", name: "computer", on: true });
    await h.pool.runTaskCommand(created.id, { kind: "toggle", name: "advisor", on: true });
    await h.pool.runTaskCommand(created.id, { kind: "browserMode", mode: "headless" });
    await h.pool.runTaskCommand(created.id, { kind: "prewalk", op: "arm" });
    const last = await h.events.until(created.id, (state) => state.sessionToggles.prewalk !== null);
    expect(last.sessionToggles).toMatchObject({
      skillful: false,
      extendedContext: true,
      computer: true,
      advisor: true,
      browser: "headless",
    });
    expect(last.sessionToggles.prewalk).toMatch(/^Prewalk: target /);
  }, 60_000);

  it("重开会话：忙时拒绝、restartable 为 false；空闲时关进程再用 --resume=<同一个会话文件> 起，回到 idle", async () => {
    const events = approvalEvents();
    const sessionFile = path.join(scratch, "sessions 重开", "r.jsonl");
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(sessionFile, "{}\n");
    const h = await harness();
    h.next.fixture = "approval";
    h.next.env = { FAKE_TSP_SESSION_FILE: sessionFile };
    const created = await h.pool.createTask({ projectId: h.projectId });
    const idle = await h.events.until(created.id, (state) => state.status === "idle");
    expect(idle.restartable).toBe(true);

    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    const waiting = await h.events.until(created.id, (state) => state.status === "needs_you");
    expect(waiting.restartable).toBe(false);
    await expect(h.pool.restartTask(created.id)).rejects.toThrow("busy");

    h.pool.sendTspEvent(created.id, events.approve);
    await h.events.until(
      created.id,
      (state) =>
        state.status === "idle" && state.restartable && h.registry.findTask(created.id)?.sessionFile === sessionFile,
    );
    h.next.fixture = "slash";
    await h.pool.restartTask(created.id);
    expect(h.launches).toEqual([{ sessionFile: null }, { sessionFile }]);
    expect(h.events.statuses(created.id).slice(-3)).toEqual(["stopped", "starting", "idle"]);
  }, 60_000);

  it("带图片的 prompt 走 @ 提及；没有会话文件的任务不能分叉", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    // 分叉会话文件（docs/architecture/session-tree.md）：这个任务还没有会话文件，所以被拒绝。
    await expect(h.pool.forkTask(created.id, null)).rejects.toThrow(/no session file yet/);
    // 模型目录来自服务进程。
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

describe("TSP 任务：斜杠命令列表（B1）和导出 HTML（B7）", () => {
  const commands = [{ name: "model", source: "builtin" as const }];

  it("命令列表来自服务进程，任务还在 starting（没有会话）时也照给，草稿页（null）同源", async () => {
    const h = await harness(undefined, { listSlashCommands: async () => commands });
    const created = await h.pool.createTask({ projectId: h.projectId });
    expect(created.status).toBe("starting");
    await expect(h.pool.listSlashCommands(created.id)).resolves.toEqual(commands);
    await expect(h.pool.listDraftSlashCommands()).resolves.toEqual(commands);
  }, 60_000);

  it("没接服务进程时列表是空的", async () => {
    const h = await harness();
    const created = await h.pool.createTask({ projectId: h.projectId });
    await expect(h.pool.listSlashCommands(created.id)).resolves.toEqual([]);
    await expect(h.pool.listDraftSlashCommands()).resolves.toEqual([]);
  }, 60_000);

  it("导出：对任务的会话文件和主进程选的输出路径调 exportSession，返回这个路径；cwd 是任务目录", async () => {
    const sessionFile = path.join(scratch, "sessions 三", "export.jsonl");
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(sessionFile, "{}\n");
    const calls: { sessionFile: string; outputPath: string; cwd: string }[] = [];
    const h = await harness(undefined, {
      exportSession: async (file, outputPath, cwd) => {
        calls.push({ sessionFile: file, outputPath, cwd });
      },
    });
    h.next.env = { FAKE_TSP_SESSION_FILE: sessionFile };
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, () => h.registry.findTask(created.id)?.sessionFile === sessionFile);
    const output = path.join(scratch, "导 出", "对话.html");
    await expect(h.pool.exportTaskHtml(created.id, output)).resolves.toBe(output);
    expect(calls).toEqual([{ sessionFile, outputPath: output, cwd: projectDir }]);
    // 相对路径直接拒绝，不调 omp。
    await expect(h.pool.exportTaskHtml(created.id, "relative.html")).rejects.toThrow(/absolute/);
    expect(calls).toHaveLength(1);
  }, 60_000);

  it("还没有会话文件（没发过消息）时导出被拒绝，不调 omp", async () => {
    const calls: string[] = [];
    const h = await harness(undefined, {
      exportSession: async (file) => {
        calls.push(file);
      },
    });
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await expect(h.pool.exportTaskHtml(created.id, path.join(scratch, "x.html"))).rejects.toThrow(/no session file/);
    expect(calls).toEqual([]);
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

  it("目录名以 `Claude ` 开头：omp 卡片上的名字去掉了这个前缀（omp 18.12.6），仍对上目录里的模型和思考强度档位", async () => {
    const claudeNamed: ModelOption = { ...catalog[0]!, name: "Claude DeepSeek V4 Flash" };
    const h = await harness(undefined, { listModels: async () => [claudeNamed] });
    const created = await h.pool.createTask({ projectId: h.projectId });
    const state = await h.events.until(created.id, (s) => s.contextUsage !== null);
    expect(state.model).toEqual(claudeNamed);
    expect(state.thinkingLevels).toEqual(["off", "low", "medium", "high"]);
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

  it("审批在等：sendPrompt 往还在的输入框发 send（omp 把它当拒绝+理由）；切模型和思考强度立刻 reject", async () => {
    const events = approvalEvents();
    const h = await harness();
    h.next.fixture = "approval";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, { text: events.text, whenBusy: "steer" });
    const waiting = await h.events.until(created.id, (s) => s.status === "needs_you");
    // 审批和提问是两个门：输入框靠 id 区分，审批不拦发送。
    expect(waiting.dialogs[0]).toMatchObject({ id: "tsp-approval", kind: "confirm", title: "Allow tool: bash" });
    const started = Date.now();
    await h.pool.sendPrompt(created.id, { text: "别跑这个，改成 echo", whenBusy: "steer" });
    await waitForLog(h.log, (records) =>
      records.some(
        (record) =>
          record.kind === "tsp" &&
          record.body?.["ev"] === "send" &&
          record.body["id"] === "j.line/input" &&
          record.body["text"] === "别跑这个，改成 echo",
      ),
    );
    await expect(h.pool.setTaskModel(created.id, flashKey)).rejects.toThrow(/composer_unavailable/);
    await expect(h.pool.setTaskThinkingLevel(created.id, "low")).rejects.toThrow(/composer_unavailable/);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 60_000);

  it("提问换掉了输入框：sendPrompt 和切模型立刻 reject（composer_unavailable），不等超时", async () => {
    const send = recordedUserEvents(loadTspFixture("ask"))[0]?.event as unknown as TspEvent | undefined;
    if (send?.ev !== "send") throw new Error("unexpected ask fixture");
    const h = await harness();
    h.next.fixture = "ask";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, { text: send.text, whenBusy: "steer" });
    const waiting = await h.events.until(created.id, (s) => s.status === "needs_you");
    expect(waiting.dialogs[0]).toMatchObject({ id: "tsp-ask", kind: "confirm" });
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

describe("rpc 引擎时代的老任务：按记录里的会话文件用 TSP 恢复", () => {
  const sessionFile = () => path.join(scratch, "sessions 二", "old.jsonl");

  async function legacyTasksFile(tasks: Record<string, unknown>[]): Promise<{ file: string; projectId: string }> {
    const file = path.join(await mkdtemp(path.join(scratch, "legacy-")), "tasks.json");
    const project = { id: "legacy-project", path: projectDir, name: "project" };
    await writeFile(file, JSON.stringify({ version: 1, projects: [project], tasks }));
    return { file, projectId: project.id };
  }
  const legacyTask = (extra: Record<string, unknown> = {}) => ({
    id: "legacy-task",
    projectId: "legacy-project",
    engine: "rpc",
    sessionFile: sessionFile(),
    title: "老任务",
    createdAt: Date.UTC(2026, 8, 1),
    updatedAt: Date.UTC(2026, 9, 1),
    archived: false,
    model: null,
    thinkingLevel: null,
    ...extra,
  });

  it("应用启动时：engine: rpc 的记录原样列出（stopped），打开它用 --resume=<同一个会话文件> 起 TSP", async () => {
    const { file } = await legacyTasksFile([legacyTask()]);
    const h = await harness(file);
    expect(h.pool.listTasks().map((s) => [s.id, s.title, s.status])).toEqual([["legacy-task", "老任务", "stopped"]]);
    await h.pool.openTask("legacy-task" as TaskId);
    await h.events.until("legacy-task" as TaskId, (s) => s.status === "idle");
    expect(h.launches).toEqual([{ sessionFile: sessionFile() }]);
  }, 60_000);

  it("迁移不动任务时间；没有会话文件的老任务就是新会话；归档的老任务恢复时同样用 TSP", async () => {
    const stamped = Date.UTC(2026, 9, 1);
    const { file } = await legacyTasksFile([
      legacyTask({ updatedAt: stamped }),
      legacyTask({ id: "fresh", sessionFile: null, title: "" }),
      legacyTask({ id: "archived", sessionFile: path.join(scratch, "sessions 二", "archived.jsonl"), archived: true }),
    ]);
    const h = await harness(file);
    expect(h.pool.listTasks().map((s) => s.id)).toEqual(["legacy-task", "fresh"]);
    expect(h.pool.listTasks()[0]?.updatedAt).toBe(stamped);
    await h.pool.openTask("legacy-task" as TaskId);
    await h.events.until("legacy-task" as TaskId, (s) => s.status === "idle");
    expect(h.registry.findTask("legacy-task" as TaskId)?.updatedAt).toBe(stamped);
    expect(h.pool.listTasks()[0]?.updatedAt).toBe(stamped);

    await h.pool.openTask("fresh" as TaskId);
    await h.events.until("fresh" as TaskId, (s) => s.status === "idle");
    expect(h.launches).toEqual([{ sessionFile: sessionFile() }, { sessionFile: null }]);

    const revived = await h.pool.resume({
      sessionFile: path.join(scratch, "sessions 二", "archived.jsonl"),
      cwd: projectDir,
      projectId: h.projectId,
      title: null,
      modifiedAt: stamped,
    });
    expect(revived).toMatchObject({ id: "archived", status: "stopped" });
    await h.pool.openTask("archived" as TaskId);
    await h.events.until("archived" as TaskId, (s) => s.status === "idle");
    expect(h.launches.at(-1)).toEqual({ sessionFile: path.join(scratch, "sessions 二", "archived.jsonl") });
  }, 60_000);
});

describe("TSP 任务：目标模式（/goal，omp 18.12.5 录制 goal-flow：一句话 → 创建 → 暂停 → 继续 → 放弃）", () => {
  const GOAL = "Run the shell command sleep 20 with the bash tool, then say done and mark the goal complete.";

  it("taskGoal 对 TSP 任务发 omp 的 /goal 命令；TaskState.goal 来自输入框卡片上的 Goal 行；放弃点掉 Drop goal? 选择器的 Yes", async () => {
    const h = await harness();
    h.next.fixture = "goal-flow";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await h.pool.sendPrompt(created.id, {
      text: "Reply with the single word PONG and nothing else.",
      whenBusy: "steer",
    });
    await h.events.until(created.id, (state) => state.status === "idle" && state.lastTurn?.status === "completed");
    expect(h.events.states.findLast((state) => state.id === created.id)?.goal).toBeNull();
    await expect(h.pool.taskGoal(created.id, "get")).resolves.toBeNull();

    const active = await h.pool.taskGoal(created.id, "create", GOAL);
    expect(active).toMatchObject({ status: "active", objective: GOAL, tokenBudget: null });
    expect(h.events.states.findLast((state) => state.id === created.id)?.goal).toMatchObject({
      status: "active",
      objective: GOAL,
    });

    const paused = await h.pool.taskGoal(created.id, "pause");
    expect(paused).toMatchObject({ status: "paused", objective: GOAL, tokensUsed: 664 });
    const resumed = await h.pool.taskGoal(created.id, "resume");
    expect(resumed).toMatchObject({ status: "active", objective: GOAL, tokensUsed: 664 });

    await expect(h.pool.taskGoal(created.id, "drop")).resolves.toBeNull();
    expect(h.events.states.findLast((state) => state.id === created.id)?.goal).toBeNull();
    expect(h.events.states.findLast((state) => state.id === created.id)?.goal).toBeNull();

    const sent = readFileSync(h.log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as LogRecord)
      .filter((record) => record.body?.["ev"] === "send" || record.body?.["ev"] === "activate")
      .map((record) =>
        record.body?.["ev"] === "send" ? record.body["text"] : `activate ${String(record.body?.["item"])}`,
      );
    expect(sent).toEqual([
      "Reply with the single word PONG and nothing else.",
      `/goal ${GOAL}`,
      "/goal pause",
      "/goal resume",
      "/goal drop",
      "activate 0",
    ]);
  }, 90_000);

  it("空的目标文字被拒绝；换行折成空格", async () => {
    const h = await harness();
    h.next.fixture = "goal-flow";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    await expect(h.pool.taskGoal(created.id, "create", "  \n ")).rejects.toThrow("goal objective is empty");
  }, 60_000);
});

describe("TSP 任务：子代理面板（hub-steer 录制：后台驱动 Agent Hub 插话）", () => {
  const STEER_TEXT = "Also say PINEAPPLE in your final reply.";

  it("steerTspSubagent：agents.open → activate → send（和录制逐字相同）→ 退出聚焦；记录读不到时给 unavailable；不认识的名字被拒", async () => {
    const h = await harness();
    h.next.fixture = "hub-steer";
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (state) => state.status === "idle");
    const first = String(recordedUserEvents(loadTspFixture("hub-steer"))[0]!.event["text"]);
    await h.pool.sendPrompt(created.id, { text: first, whenBusy: "steer" });
    // 假 omp 放帧到录制里用户点 👥 的那一步就停下等事件：两个子代理都在跑。
    const deadline = Date.now() + 20_000;
    for (;;) {
      const agents = listAgents(restoreDocument(h.pool.getTspSnapshot(created.id).document));
      if (agents.filter((agent) => agent.status === "running").length === 2) break;
      if (Date.now() > deadline) throw new Error("the subagents never showed up as running");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    await expect(h.pool.steerTspSubagent(created.id, "Gamma", "hi")).rejects.toThrow(/unknown subagent/);
    await expect(h.pool.getTspSubagentRecord(created.id, "Beta")).resolves.toMatchObject({
      messages: null,
      unavailable: "no_session",
    });

    await h.pool.steerTspSubagent(created.id, "Beta", STEER_TEXT);
    await waitForLog(h.log, (records) =>
      records.some((record) => record.kind === "tsp" && record.body?.["act"] === "focus:Main"),
    );
    const sent = readFileSync(h.log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as LogRecord)
      .filter((record) => record.kind === "tsp" && ["send", "action", "activate"].includes(String(record.body?.["ev"])))
      .map((record) => [record.body?.["ev"], record.body?.["act"] ?? record.body?.["item"] ?? record.body?.["text"]]);
    expect(sent).toEqual([
      ["send", first],
      ["action", "agents.open"],
      ["activate", "Beta"],
      ["send", STEER_TEXT],
      ["action", "focus:Main"],
    ]);
    // 驱动结束：聚焦行没了（回放放出 focus 删除帧），文档里没有 Hub，输入框又是主会话的发送目标。
    await expect
      .poll(
        () => {
          const document = restoreDocument(h.pool.getTspSnapshot(created.id).document);
          return [findFocus(document), findAgentHub(document), findMessageTarget(document).kind];
        },
        { timeout: 20_000 },
      )
      .toEqual([null, null, "ready"]);
  }, 90_000);
});
