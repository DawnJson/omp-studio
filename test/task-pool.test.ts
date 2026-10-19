import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProjectId, StudioSettings, TaskId, TaskNotice, TaskState, TranscriptBatch } from "../src/shared/ipc.ts";
import { IDLE_RECYCLE_MS, TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";
import { applyTranscriptEvent, emptyTranscript } from "../src/shared/transcript.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const fixture = (name: string) => path.join(root, "fixtures", "rpc", `${name}.ndjson`);
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  // 路径带空格和中文：开发机上就有这种路径。
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 任务池-"));
  projectDir = path.join(scratch, "项目 一");
  await mkdir(projectDir);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const settings = (maxLiveProcesses = 6): StudioSettings => ({
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  goalAutoContinue: true,
  yoloConfirmed: false,
});

/** 收集池推送的事件；`until` 等到某个任务的状态满足条件（事件驱动，没有固定等待）。 */
class Events {
  states: TaskState[] = [];
  batches: TranscriptBatch[] = [];
  notices: TaskNotice[] = [];
  removed: TaskId[] = [];
  #waiters: { predicate: (state: TaskState) => boolean; resolve: (state: TaskState) => void }[] = [];

  readonly sink = {
    state: (state: TaskState) => {
      this.states.push(state);
      this.#waiters = this.#waiters.filter((waiter) =>
        waiter.predicate(state) ? (waiter.resolve(state), false) : true,
      );
    },
    transcript: (batch: TranscriptBatch) => this.batches.push(batch),
    notice: (notice: TaskNotice) => this.notices.push(notice),
    taskRemoved: (id: TaskId) => this.removed.push(id),
    slashCommands: () => {},
    subagents: () => {},
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

interface Harness {
  pool: TaskPool;
  events: Events;
  registry: TaskRegistry;
  tasksFile: string;
  projectId: ProjectId;
  /** 下一次 spawn 用的 fixture（按顺序消耗）。 */
  fixtures: string[];
  launches: { cwd: string }[];
}

const pools: TaskPool[] = [];
async function harness(
  options: { maxLive?: number; buildLaunchError?: Error; gate?: Promise<void> } = {},
): Promise<Harness> {
  const events = new Events();
  const tasksFile = path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json");
  const registry = new TaskRegistry(tasksFile);
  const fixtures: string[] = [];
  const launches: { cwd: string }[] = [];
  const pool = new TaskPool({
    registry,
    getSettings: async () => settings(options.maxLive),
    buildLaunch: async (_record, project) => {
      if (options.buildLaunchError) throw options.buildLaunchError;
      await options.gate;
      const next = fixtures.shift();
      if (!next) throw new Error("test did not provide a fixture for this spawn");
      launches.push({ cwd: project.path });
      return { command: process.execPath, args: [fakeOmp, next], cwd: project.path, env: process.env };
    },
    assignJob: () => {},
    events: events.sink,
  });
  pools.push(pool);
  await pool.init();
  const project = await pool.ensureProject(projectDir);
  return { pool, events, registry, tasksFile, projectId: project.id, fixtures, launches };
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

function transcriptOf(batches: TranscriptBatch[], id: TaskId) {
  return batches
    .filter((b) => b.taskId === id)
    .flatMap((b) => b.events)
    .reduce(applyTranscriptEvent, emptyTranscript());
}

const turn = { text: "用一句中文回答：1+1 等于几？不要调用任何工具。", whenBusy: "steer" as const };

describe("任务池：用 fake-omp 回放 createTask → sendPrompt → 完成", () => {
  it("状态依次 starting → idle → running → idle，对话流里有用户消息和回答，标题取首条消息", async () => {
    const h = await harness();
    h.fixtures.push(fixture("simple-reply"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    expect(created).toMatchObject({ status: "starting", title: "" });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, turn);
    const done = await h.events.until(created.id, (s) => s.lastTurn?.status === "completed" && s.status === "idle");

    expect(h.events.statuses(created.id)).toEqual(["starting", "idle", "running", "idle"]);
    expect(h.events.states.filter((s) => s.status === "running").every((s) => typeof s.runStartedAt === "number")).toBe(
      true,
    );
    expect(done.runStartedAt).toBeNull();
    expect(done.title).toBe("用一句中文回答：1+1 等于几？不要调用任何工具。");
    expect(done.model?.key).toEqual({ provider: "deepseek", modelId: "deepseek-v4-flash" });
    const snapshot = await h.pool.openTask(created.id);
    const messages = snapshot.transcript.items.flatMap((item) => (item.kind === "message" ? [item.message] : []));
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    // 推送出去的批次和快照一致：渲染进程增量重建的结果等于快照。
    expect(transcriptOf(h.events.batches, created.id)).toEqual(snapshot.transcript);
    expect(h.launches[0]?.cwd).toBe(path.resolve(projectDir));
  });

  it("一轮结束后 TaskState 带上本会话的用量（get_session_stats）和上下文占用", async () => {
    // 输入框下方的用量行靠它显示：没有这条，用户看不到本会话花了多少。
    const h = await harness();
    h.fixtures.push(fixture("session-stats"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, turn);
    const state = await h.events.until(created.id, (s) => s.sessionUsage !== null);
    expect(state.sessionUsage).toMatchObject({ tokens: { total: 9206, input: 243, output: 3 }, premiumRequests: 0 });
    expect(state.sessionUsage?.cost).toBeCloseTo(0.00006513, 8);
    expect(state.contextUsage?.contextWindow).toBe(1_000_000);
    expect(state.model).toMatchObject({ contextWindow: 1_000_000, cost: { input: expect.any(Number) } });
  });

  it("会话文件在第一轮结束后写进 tasks.json，重启应用后任务还在、状态是 stopped", async () => {
    const h = await harness();
    h.fixtures.push(fixture("simple-reply"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, turn);
    // get_state 在 prompt_result 之后异步刷新，sessionFile 随后落盘并推一次状态；等它出现在 registry 里。
    await h.events.until(created.id, () => Boolean(h.registry.findTask(created.id)?.sessionFile));
    await h.registry.save();
    const record = h.registry.findTask(created.id);
    expect(record?.sessionFile).toMatch(/\.jsonl$/);

    const reopened = new TaskPool({
      registry: new TaskRegistry(h.tasksFile),
      getSettings: async () => settings(),
      buildLaunch: async () => {
        throw new Error("no spawn expected");
      },
      assignJob: () => {},
      events: new Events().sink,
    });
    await reopened.init();
    expect(reopened.listTasks()).toMatchObject([{ id: created.id, status: "stopped", title: record?.title }]);
  });

  it("审批：select 到达时任务是 needs_you 且 approval=true；伪造的值被拒、任务仍在等；批准后继续跑完", async () => {
    const h = await harness();
    h.fixtures.push(fixture("approval-select"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, {
      text: "用 bash 工具运行 echo omp-studio，然后用一句话告诉我输出。",
      whenBusy: "steer",
    });
    const waiting = await h.events.until(created.id, (s) => s.status === "needs_you");
    const dialog = waiting.dialogs[0]!;
    expect(dialog).toMatchObject({ kind: "select", approval: true });

    await expect(
      h.pool.respondDialog(created.id, dialog.id, { kind: "value", value: "Approve and also rm -rf" }),
    ).rejects.toThrow(/not one of the options/);
    await expect(h.pool.respondDialog(created.id, "forged-id", { kind: "cancel" })).rejects.toThrow(
      /no pending dialog/,
    );
    expect(h.pool.listTasks()[0]?.status).toBe("needs_you");

    await h.pool.respondDialog(created.id, dialog.id, { kind: "value", value: "Approve" });
    await expect(h.pool.respondDialog(created.id, dialog.id, { kind: "cancel" })).rejects.toThrow(/no pending dialog/);
    const done = await h.events.until(created.id, (s) => s.lastTurn?.status === "completed" && s.status === "idle");
    expect(done.dialogs).toEqual([]);
    expect(transcriptOf(h.events.batches, created.id).tools).not.toEqual({});
  });

  it("ask 对话框：答案形状不对被拒，合规的答案让这一轮继续", async () => {
    const h = await harness();
    h.fixtures.push(fixture("ask-dialog"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, { text: "问我", whenBusy: "steer" });
    const waiting = await h.events.until(created.id, (s) => s.status === "needs_you");
    const dialog = waiting.dialogs[0]!;
    expect(dialog.kind).toBe("ask");
    await expect(
      h.pool.respondDialog(created.id, dialog.id, {
        kind: "answers",
        answers: [{ id: "lang", selectedOptions: ["Go", "Rust"] }],
      }),
    ).rejects.toThrow(/single-select/);
    await h.pool.respondDialog(created.id, dialog.id, {
      kind: "answers",
      answers: [{ id: "lang", selectedOptions: ["Go"] }],
    });
    await h.events.until(created.id, (s) => s.lastTurn?.status === "completed" && s.status === "idle");
  });

  it("provider 报错：prompt_result=error 时任务回到 idle，lastTurn 带错误，对话流有 prompt_error；看过后清除", async () => {
    const h = await harness();
    h.fixtures.push(fixture("turn-error"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, { text: "说一个字。", whenBusy: "steer" });
    const failed = await h.events.until(created.id, (s) => s.lastTurn?.status === "error" && s.status === "idle");
    expect(failed.lastTurn?.error).toMatchObject({ httpStatus: 401, retryable: false });
    expect(failed.unread).toBe(true);
    const snapshot = h.pool.getTranscript(created.id);
    expect(snapshot.transcript.items.some((item) => item.kind === "prompt_error")).toBe(true);
    h.pool.markTaskRead(created.id);
    expect(h.pool.listTasks()[0]).toMatchObject({ unread: false, lastTurn: null });
  });

  it("运行中再发两条（steer、followUp）：队列 chip 按 queue_update 给出，最后回到 idle 且队列为空", async () => {
    const h = await harness();
    h.fixtures.push(fixture("queue-steer"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, { text: "依次运行三个 echo", whenBusy: "steer" });
    await h.events.until(created.id, (s) => s.status === "running");
    // 录制时两条是连续发出、应答在后面（fixture 里两个 in 相邻），回放要保持同样的发送方式。
    await Promise.all([
      h.pool.sendPrompt(created.id, { text: "改成只做一次就停下", whenBusy: "steer" }),
      h.pool.sendPrompt(created.id, { text: "最后再用一个词总结", whenBusy: "followUp" }),
    ]);
    const done = await h.events.until(
      created.id,
      (s) =>
        s.status === "idle" &&
        s.lastTurn !== null &&
        s.queue.steering.length === 0 &&
        s.queue.followUp.length === 0 &&
        h.events.states.some((x) => x.queue.followUp.length > 0),
    );
    expect(h.events.states.some((s) => s.queue.steering.length === 1)).toBe(true);
    expect(done.queue).toEqual({ steering: [], followUp: [] });
  });

  it("恢复会话：以会话文件起进程、读完历史；标题取历史里第一条用户消息；已挂着该会话的任务不重复建", async () => {
    const h = await harness();
    h.fixtures.push(fixture("resume-history"));
    const sessionFile = path.join(scratch, "sessions", "旧 会话.jsonl");
    const state = await h.pool.resume({ sessionFile, cwd: projectDir, projectId: h.projectId, title: null });
    await h.events.until(state.id, (s) => s.status === "idle");
    const snapshot = await h.pool.openTask(state.id);
    expect(snapshot.transcript.items.map((item) => item.kind === "message" && item.message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(h.pool.listTasks()[0]?.title).toBe("用一句中文回答：1+1 等于几？不要调用任何工具。");
    // omp 报告的会话文件路径是权威的（历史列表里的路径就是它）。
    const reported = h.registry.findTask(state.id)!.sessionFile!;
    const again = await h.pool.resume({ sessionFile: reported, cwd: projectDir, projectId: h.projectId, title: null });
    expect(again.id).toBe(state.id);
    expect(h.pool.listTasks()).toHaveLength(1);
  });
});

/** 构造一份只有初始化序列的 fixture，再追加 `tail`。 */
async function inlineFixture(
  name: string,
  options: { resume?: boolean; tail?: object[]; sessionFile?: string; busy?: boolean } = {},
): Promise<string> {
  const id = (n: number) => `r${n}`;
  const frames: object[] = [
    {
      kind: "out",
      frame: {
        type: "ready",
        protocolVersion: 1,
        supportedProtocolVersions: [1, 2],
        maxFrameBytes: 1048576,
        maxReassembledFrameBytes: 67108864,
      },
    },
    { kind: "in", frame: { type: "negotiate_protocol", id: id(1) } },
    {
      kind: "out",
      frame: {
        type: "response",
        command: "negotiate_protocol",
        id: id(1),
        success: true,
        data: { protocolVersion: 2 },
      },
    },
    { kind: "in", frame: { type: "set_event_filter", id: id(2) } },
    {
      kind: "out",
      frame: {
        type: "response",
        command: "set_event_filter",
        id: id(2),
        success: true,
        data: { events: null, messageUpdates: "delta" },
      },
    },
    { kind: "in", frame: { type: "set_ask_dialog", id: id(3) } },
    {
      kind: "out",
      frame: { type: "response", command: "set_ask_dialog", id: id(3), success: true, data: { enabled: true } },
    },
    { kind: "in", frame: { type: "set_subagent_subscription", id: id(4) } },
    {
      kind: "out",
      frame: {
        type: "response",
        command: "set_subagent_subscription",
        id: id(4),
        success: true,
        data: { level: "progress" },
      },
    },
  ];
  let n = 5;
  if (options.resume) {
    frames.push(
      { kind: "in", frame: { type: "switch_session", id: id(n) } },
      {
        kind: "out",
        frame: { type: "response", command: "switch_session", id: id(n), success: true, data: { cancelled: false } },
      },
    );
    n++;
  }
  frames.push(
    { kind: "in", frame: { type: "get_state", id: id(n) } },
    {
      kind: "out",
      frame: {
        type: "response",
        command: "get_state",
        id: id(n),
        success: true,
        data: {
          sessionId: "s1",
          isSettled: !options.busy,
          hasPendingAsyncWork: false,
          ...(options.sessionFile && { sessionFile: options.sessionFile }),
        },
      },
    },
    { kind: "in", frame: { type: "get_available_thinking_levels", id: id(n + 1) } },
    {
      kind: "out",
      frame: {
        type: "response",
        command: "get_available_thinking_levels",
        id: id(n + 1),
        success: true,
        data: { levels: ["off", "low"] },
      },
    },
    ...(options.tail ?? []),
  );
  const file = path.join(scratch, `${name}.ndjson`);
  await writeFile(file, frames.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return file;
}

describe("任务池：失败路径", () => {
  it("omp 在回答中途意外退出：任务进 error（kind=exited），带 stderr 摘要之外的退出码；restartTask 能重新拉起", async () => {
    const h = await harness();
    h.fixtures.push(
      await inlineFixture("crash", {
        tail: [
          { kind: "in", frame: { type: "prompt", id: "r9" } },
          { kind: "exit", code: 7 },
        ],
      }),
      await inlineFixture("restart"),
    );
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    // prompt 的应答永远不会来：进程退出让它 reject。
    await expect(h.pool.sendPrompt(created.id, turn)).rejects.toThrow();
    const failed = await h.events.until(created.id, (s) => s.status === "error");
    expect(failed.error).toMatchObject({ kind: "exited" });
    expect(failed.error?.message).toContain("7");
    await h.pool.restartTask(created.id);
    expect(h.pool.listTasks()[0]?.status).toBe("idle");
  });

  it("找不到可用的 omp：任务进 error（omp_unavailable），而不是卡在 starting", async () => {
    const h = await harness({ buildLaunchError: new Error("omp is not installed") });
    const created = await h.pool.createTask({ projectId: h.projectId });
    const failed = await h.events.until(created.id, (s) => s.status === "error");
    expect(failed.error).toEqual({ kind: "omp_unavailable", message: "omp is not installed" });
  });

  it("发送 prompt 的应答是 success:false：任务留在 idle，错误进对话流，调用方拿到异常", async () => {
    const h = await harness();
    h.fixtures.push(
      await inlineFixture("reject", {
        tail: [
          { kind: "in", frame: { type: "prompt", id: "r9" } },
          {
            kind: "out",
            frame: {
              type: "response",
              command: "prompt",
              id: "r9",
              success: false,
              error: "Agent is already processing",
            },
          },
        ],
      }),
    );
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await expect(h.pool.sendPrompt(created.id, turn)).rejects.toThrow(/already processing/);
    const state = h.pool.listTasks()[0]!;
    expect(state).toMatchObject({ status: "idle", lastTurn: { status: "error" } });
    expect(h.pool.getTranscript(created.id).transcript.items.some((item) => item.kind === "prompt_error")).toBe(true);
  });

  it("超过帧大小上限的消息在发出前就被拒，omp 不会收到", async () => {
    const h = await harness();
    h.fixtures.push(await inlineFixture("big"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await expect(
      h.pool.sendPrompt(created.id, { text: "x".repeat(1024 * 1024 + 1), whenBusy: "steer" }),
    ).rejects.toThrow(/frame limit/);
  });
});

describe("任务池：进程上限、回收、归档", () => {
  it("到软上限时回收最久未用的可回收任务；正在前台的任务不会被回收", async () => {
    const h = await harness({ maxLive: 2 });
    const ids: TaskId[] = [];
    for (const name of ["a", "b", "c"]) {
      h.fixtures.push(await inlineFixture(`limit-${name}`));
      const created = await h.pool.createTask({ projectId: h.projectId });
      await h.events.until(created.id, (s) => s.status === "idle");
      ids.push(created.id);
    }
    const [a, b, c] = ids as [TaskId, TaskId, TaskId];
    expect(h.events.statuses(a)).toEqual(["starting", "idle", "stopped"]);
    expect(h.pool.listTasks().find((s) => s.id === b)?.status).toBe("idle");
    expect(h.pool.listTasks().find((s) => s.id === c)?.status).toBe("idle");

    // b 在前台，d 启动时只能回收 c。
    await h.pool.openTask(b);
    h.fixtures.push(await inlineFixture("limit-d"));
    const d = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(d.id, (s) => s.status === "idle");
    expect(h.pool.listTasks().find((s) => s.id === b)?.status).toBe("idle");
    expect(h.pool.listTasks().find((s) => s.id === c)?.status).toBe("stopped");
  });

  it("存活进程到硬上限（软上限 × 2）且没有可回收的任务时，新任务进 error(too_many_tasks)", async () => {
    const h = await harness({ maxLive: 1 });
    const ids: TaskId[] = [];
    for (const name of ["a", "b", "c"]) {
      h.fixtures.push(await inlineFixture(`hard-${name}`, { busy: true }));
      const created = await h.pool.createTask({ projectId: h.projectId });
      ids.push(created.id);
      await h.events.until(created.id, (s) => s.status === "idle" || s.status === "error");
    }
    expect(h.pool.listTasks().map((s) => s.status)).toEqual(["idle", "idle", "error"]);
    expect(h.pool.listTasks()[2]?.error?.kind).toBe("too_many_tasks");
  });

  it("可回收状态持续 15 分钟才关进程；没到点不关；回收后对话快照还在", async () => {
    const h = await harness();
    h.fixtures.push(await inlineFixture("idle-recycle"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    const t0 = 1_000_000;
    await h.pool.sweep(t0);
    await h.pool.sweep(t0 + IDLE_RECYCLE_MS - 1);
    expect(h.pool.listTasks()[0]?.status).toBe("idle");
    await h.pool.sweep(t0 + IDLE_RECYCLE_MS);
    expect(h.pool.listTasks()[0]?.status).toBe("stopped");
  });

  it("relaunchIdleProcesses：空闲的后台任务关掉，前台任务关掉后立刻重启", async () => {
    const h = await harness();
    h.fixtures.push(await inlineFixture("relaunch-a"), await inlineFixture("relaunch-b"));
    const a = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(a.id, (s) => s.status === "idle");
    const b = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(b.id, (s) => s.status === "idle");
    await h.pool.openTask(b.id);
    const spawnsBefore = h.launches.length;
    h.fixtures.push(await inlineFixture("relaunch-b2"));
    await h.pool.relaunchIdleProcesses();
    const states = h.pool.listTasks();
    expect(states.find((s) => s.id === a.id)?.status).toBe("stopped");
    expect(states.find((s) => s.id === b.id)?.status).toBe("idle");
    expect(h.launches.length).toBe(spawnsBefore + 1);
  });

  it("归档：关进程、从列表移除、tasks.json 保留记录；resume 同一会话文件把它恢复成未归档（同一 id）", async () => {
    const h = await harness();
    const sessionFile = path.join(scratch, "sessions", "归档.jsonl");
    h.fixtures.push(await inlineFixture("archive-1", { sessionFile }));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.registry.updateTask(created.id, { sessionFile });
    await h.pool.archiveTask(created.id);
    expect(h.events.removed).toEqual([created.id]);
    expect(h.pool.listTasks()).toEqual([]);
    expect(h.registry.findTask(created.id)).toMatchObject({ archived: true, sessionFile });

    const back = await h.pool.resume({ sessionFile, cwd: projectDir, projectId: h.projectId, title: null });
    expect(back.id).toBe(created.id);
    expect(h.registry.findTask(created.id)?.archived).toBe(false);
    expect(h.pool.listTasks()).toHaveLength(1);
  });

  it("项目下还有未归档任务时不能移除项目，归档后可以", async () => {
    const h = await harness();
    h.fixtures.push(await inlineFixture("remove-project"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await expect(h.pool.removeProject(h.projectId)).rejects.toThrow(/still has tasks/);
    await h.pool.archiveTask(created.id);
    await h.pool.removeProject(h.projectId);
    expect(h.pool.listProjects()).toEqual([]);
  });

  it("shutdown 关掉所有进程，任务回到 stopped", async () => {
    const h = await harness();
    h.fixtures.push(await inlineFixture("shutdown-1"), await inlineFixture("shutdown-2"));
    const one = await h.pool.createTask({ projectId: h.projectId });
    const two = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(one.id, (s) => s.status === "idle");
    await h.events.until(two.id, (s) => s.status === "idle");
    await h.pool.shutdown();
    expect(h.pool.listTasks().map((s) => s.status)).toEqual(["stopped", "stopped"]);
  });
});

/** 一个一启动就在 marker 文件里留痕的"omp"：用来断言有没有 spawn 过。 */
async function markerCommand(name: string): Promise<{ command: string; args: string[]; marker: string }> {
  const marker = path.join(scratch, `${name}.spawned`);
  return {
    command: process.execPath,
    args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
    marker,
  };
}
const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

describe("任务池：启动过程中的归档和退出（不留孤儿进程、不推幽灵状态）", () => {
  it("buildLaunch 还在等（比如 omp 在下载）时归档：放行后不 spawn，归档之后没有任何 taskState 或 transcript 推送", async () => {
    const gate = Promise.withResolvers<void>();
    const spawned = await markerCommand("archive-during-start");
    const events = new Events();
    const registry = new TaskRegistry(path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json"));
    const pool = new TaskPool({
      registry,
      getSettings: async () => settings(),
      buildLaunch: async (_record, project) => {
        await gate.promise;
        return { command: spawned.command, args: spawned.args, cwd: project.path, env: process.env };
      },
      assignJob: () => {},
      events: events.sink,
    });
    pools.push(pool);
    await pool.init();
    const project = await pool.ensureProject(projectDir);
    const created = await pool.createTask({ projectId: project.id });
    const archived = pool.archiveTask(created.id);
    gate.resolve();
    await archived;
    const statesAtRemoval = events.states.length;
    expect(events.removed).toEqual([created.id]);
    expect(await exists(spawned.marker)).toBe(false);
    expect(events.states).toHaveLength(statesAtRemoval);
    expect(events.states.at(-1)?.status).not.toBe("idle");
    expect(pool.listTasks()).toEqual([]);
  });

  it("buildLaunch 还在等时应用退出：shutdown 等启动中止，不 spawn；任务是 stopped 而不是 error", async () => {
    const gate = Promise.withResolvers<void>();
    const spawned = await markerCommand("shutdown-during-start");
    const events = new Events();
    const pool = new TaskPool({
      registry: new TaskRegistry(path.join(await mkdtemp(path.join(scratch, "ud-")), "tasks.json")),
      getSettings: async () => settings(),
      buildLaunch: async (_record, project) => {
        await gate.promise;
        return { command: spawned.command, args: spawned.args, cwd: project.path, env: process.env };
      },
      assignJob: () => {},
      events: events.sink,
    });
    pools.push(pool);
    await pool.init();
    const project = await pool.ensureProject(projectDir);
    const created = await pool.createTask({ projectId: project.id });
    const down = pool.shutdown();
    gate.resolve();
    await down;
    expect(await exists(spawned.marker)).toBe(false);
    expect(pool.listTasks()[0]?.status).toBe("stopped");
    expect(events.statuses(created.id)).not.toContain("error");
  });

  it("握手进行中归档：已 spawn 的进程被关掉（omp 退出），不进 error，也不再推状态", async () => {
    const h = await harness();
    // 只有 ready，没有 negotiate 的应答：握手卡住，进程活着。
    h.fixtures.push(await inlineFixture("stuck-handshake-base"));
    const stuck = path.join(scratch, "stuck-handshake.ndjson");
    await writeFile(
      stuck,
      JSON.stringify({
        kind: "out",
        frame: {
          type: "ready",
          protocolVersion: 1,
          supportedProtocolVersions: [1, 2],
          maxFrameBytes: 1048576,
          maxReassembledFrameBytes: 67108864,
        },
      }) +
        "\n" +
        JSON.stringify({ kind: "hang" }) +
        "\n",
    );
    h.fixtures.splice(0, 1, stuck);
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "starting");
    await h.pool.archiveTask(created.id);
    const after = h.events.states.length;
    expect(h.events.statuses(created.id)).not.toContain("error");
    expect(h.events.states).toHaveLength(after);
  });
});

describe("任务池：在途命令、已停止任务、刷新", () => {
  it("prompt 的应答还没回来时，15 分钟定时回收和软上限回收都不能关掉它", async () => {
    const h = await harness();
    // prompt 发出去之后 omp 一直不应答。
    h.fixtures.push(
      await inlineFixture("inflight-prompt", {
        tail: [{ kind: "in", frame: { type: "prompt", id: "r9" } }, { kind: "hang" }],
      }),
    );
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    const t0 = 5_000_000;
    await h.pool.sweep(t0);
    const sending = h.pool.sendPrompt(created.id, turn);
    sending.catch(() => {});
    await h.pool.sweep(t0 + IDLE_RECYCLE_MS * 2);
    expect(h.pool.listTasks()[0]?.status).toBe("idle");
    await h.pool.shutdown();
    await expect(sending).rejects.toThrow();
  });

  it("任务已停止时，停止、删除排队、提前排队、列模型都不会拉起 omp，返回空结果", async () => {
    const h = await harness();
    h.fixtures.push(await inlineFixture("stopped-ops"));
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sweep(1);
    await h.pool.sweep(1 + IDLE_RECYCLE_MS);
    expect(h.pool.listTasks()[0]?.status).toBe("stopped");
    const spawnsBefore = h.launches.length;
    expect(await h.pool.stopTask(created.id)).toEqual({
      steering: [],
      followUp: [],
      imagesDropped: false,
      truncated: false,
      aborted: true,
      backgroundWork: false,
    });
    expect(await h.pool.removeQueuedMessage(created.id, "x", "steering")).toBeNull();
    expect(await h.pool.promoteQueuedMessage(created.id, "x")).toBe(false);
    expect(await h.pool.listTaskModels(created.id)).toEqual([]);
    expect(h.launches).toHaveLength(spawnsBefore);
    expect(h.pool.listTasks()[0]?.status).toBe("stopped");
  });

  // 回归：Esc 提示"已停止"，任务却继续跑完。真机复现（Tern omp 18.12.2）：steer 让运行中的 bash 转后台，
  // abort_and_restore_queue 成功、排队消息也撤回了，但转后台的 job 结束时 omp 自己开了新一轮。
  // 旧逻辑只信 abort 命令的应答，一律说"已停止"；现在要用 get_state 核实这一轮停没停、后台任务还会不会唤醒会话。
  const stopTail = (state: object) => [
    { kind: "in", frame: { type: "abort_and_restore_queue", id: "r10" } },
    {
      kind: "out",
      frame: {
        type: "response",
        command: "abort_and_restore_queue",
        id: "r10",
        success: true,
        data: { steering: [{ text: "记得用中文" }], followUp: [{ text: "最后加一句再见" }] },
      },
    },
    { kind: "in", frame: { type: "get_state", id: "r11" } },
    { kind: "out", frame: { type: "response", command: "get_state", id: "r11", success: true, data: state } },
  ];

  it("停止：撤回的 steer 和 followUp 按原文返回；有转后台的任务会唤醒会话时报 backgroundWork，不当作干净停止", async () => {
    const h = await harness();
    h.fixtures.push(
      await inlineFixture("stop-background", {
        tail: stopTail({ sessionId: "s1", isStreaming: false, isSettled: false, hasPendingAsyncWork: true }),
      }),
    );
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    expect(await h.pool.stopTask(created.id)).toEqual({
      steering: [{ text: "记得用中文" }],
      followUp: [{ text: "最后加一句再见" }],
      imagesDropped: false,
      truncated: false,
      aborted: true,
      backgroundWork: true,
    });
  });

  it("停止：abort 之后 omp 仍在流式输出，aborted 为 false（界面不能说已停止）", async () => {
    const h = await harness();
    h.fixtures.push(
      await inlineFixture("stop-still-streaming", {
        tail: stopTail({ sessionId: "s1", isStreaming: true, isSettled: false, hasPendingAsyncWork: false }),
      }),
    );
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    const result = await h.pool.stopTask(created.id);
    expect(result.aborted).toBe(false);
    expect(result.backgroundWork).toBe(false);
    expect(result.followUp).toEqual([{ text: "最后加一句再见" }]);
  });

  it("get_state 刷新进行中又来了新的刷新请求：结束后补跑，最终拿到 settled，任务才可回收", async () => {
    const h = await harness();
    const refresh = (settled: boolean, n: number) => [
      { kind: "in", frame: { type: "get_available_thinking_levels", id: `t${n}` } },
      {
        kind: "out",
        frame: {
          type: "response",
          command: "get_available_thinking_levels",
          id: `t${n}`,
          success: true,
          data: { levels: ["off"] },
        },
      },
      { kind: "in", frame: { type: "get_state", id: `g${n}` } },
      {
        kind: "out",
        frame: {
          type: "response",
          command: "get_state",
          id: `g${n}`,
          success: true,
          data: { sessionId: "s1", isSettled: settled, hasPendingAsyncWork: false },
        },
      },
    ];
    h.fixtures.push(
      await inlineFixture("refresh-again", {
        busy: true,
        tail: [
          { kind: "in", frame: { type: "prompt", id: "r9" } },
          { kind: "out", frame: { type: "response", command: "prompt", id: "r9", success: true } },
          // 同一批里：model_changed 触发刷新，紧接着这一轮 settled。第一次刷新的应答是过期的（未 settled）。
          { kind: "out", frame: { type: "model_changed" } },
          {
            kind: "out",
            frame: { type: "prompt_result", id: "r9", agentInvoked: true, status: "completed", sessionSettled: true },
          },
          { kind: "out", frame: { type: "session_settled" } },
          ...refresh(false, 1),
          ...refresh(true, 2),
        ],
      }),
    );
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, turn);
    await h.events.until(created.id, (s) => s.lastTurn?.status === "completed" && s.status === "idle");
    // 回收判据来自 get_state：等第二次刷新的应答处理完（thinkingLevels 被刷新两次都是 ["off"]，用 sweep 直接验证）。
    const settled = Promise.withResolvers<void>();
    const poll = async () => {
      for (let i = 0; i < 200; i++) {
        await h.pool.sweep(10_000_000);
        await h.pool.sweep(10_000_000 + IDLE_RECYCLE_MS);
        if (h.pool.listTasks()[0]?.status === "stopped") return settled.resolve();
        await new Promise((resolve) => setImmediate(resolve));
      }
      settled.reject(new Error("task never became recyclable"));
    };
    void poll();
    await settled.promise;
  });

  it("对话框应答超过帧大小上限：在本地拒绝并报错，对话框仍在，任务不会卡死", async () => {
    const h = await harness();
    h.fixtures.push(
      await inlineFixture("big-dialog", {
        tail: [
          { kind: "in", frame: { type: "prompt", id: "r9" } },
          { kind: "out", frame: { type: "response", command: "prompt", id: "r9", success: true } },
          { kind: "out", frame: { type: "agent_start" } },
          { kind: "out", frame: { type: "extension_ui_request", id: "ui1", method: "input", title: "name?" } },
        ],
      }),
    );
    const created = await h.pool.createTask({ projectId: h.projectId });
    await h.events.until(created.id, (s) => s.status === "idle");
    await h.pool.sendPrompt(created.id, turn);
    const waiting = await h.events.until(created.id, (s) => s.status === "needs_you");
    await expect(
      h.pool.respondDialog(created.id, waiting.dialogs[0]!.id, { kind: "value", value: "好".repeat(400_000) }),
    ).rejects.toThrow(/frame limit/);
    expect(h.pool.listTasks()[0]).toMatchObject({ status: "needs_you" });
    expect(h.pool.listTasks()[0]?.dialogs).toHaveLength(1);
  });
});
