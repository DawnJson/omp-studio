// 分叉 / 回溯 / 会话树：用假 omp 回放实测过的 RPC 往返（docs/architecture/session-tree.md）。
// 实测语义：`branch {entryId}` 新建会话文件并把进程切过去（应答 `{text, cancelled}`，文件 = 该用户消息之前的历史），
// 原文件不变；`switch_session` 切回去。所以 forkSession 是 branch → get_state → switch_session，branchInPlace 是 branch → 读新历史。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StudioSettings, TaskId, TaskState, TranscriptSnapshot } from "../src/shared/ipc.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio fork-"));
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
  goalAutoContinue: true,
  yoloConfirmed: false,
};

type Entry = Record<string, unknown>;
interface Recorded extends Entry {
  frame?: { type?: string; command?: string; data?: Record<string, unknown> };
}

const FORK_FILE = path.join(os.tmpdir(), "omp-fork-test", "forked.jsonl");
const BRANCH_FILE = path.join(os.tmpdir(), "omp-fork-test", "branched.jsonl");

let recorded: Recorded[];
beforeAll(async () => {
  recorded = (await readFile(path.join(root, "fixtures", "rpc", "simple-reply.ndjson"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line): Recorded => JSON.parse(line));
});

const USER_TEXT = "用一句中文回答：1+1 等于几？不要调用任何工具。";
const baseState = (): Record<string, unknown> => {
  const entry = recorded.find((line) => line.frame?.command === "get_state" && line.frame.data);
  return entry!.frame!.data!;
};
const withFile = (sessionFile: string, extra: Entry = {}): Entry => ({
  kind: "state",
  command: "get_state",
  data: { ...baseState(), sessionFile, ...extra },
});

const response = (id: string, command: string, data?: unknown): Entry => ({
  kind: "out",
  frame: { id, type: "response", command, success: true, ...(data !== undefined && { data }) },
});
const expectIn = (type: string, id: string): Entry => ({ kind: "in", frame: { type, id } });

/** 整份 simple-reply（握手 + 一轮对话）后接这条测试自己的往返。 */
async function fixtureAfterTurn(tail: Entry[]): Promise<string> {
  const file = path.join(await mkdtemp(path.join(scratch, "fx-")), "fork.ndjson");
  await writeFile(file, [...recorded, ...tail, { kind: "hang" }].map((entry) => JSON.stringify(entry)).join("\n"));
  return file;
}

/** 分叉出的任务自己起进程：握手里 switch_session 到新文件，再读历史。 */
async function forkedTaskFixture(dir: string): Promise<string> {
  const handshake = recorded.slice(0, 13);
  const file = path.join(dir, "forked-task.ndjson");
  const lines: Entry[] = [
    ...handshake,
    expectIn("switch_session", "w1"),
    response("w1", "switch_session", { cancelled: false }),
    ...recorded.slice(13, 17),
    expectIn("get_messages_page", "p1"),
    response("p1", "get_messages_page", { messages: [] }),
    { kind: "hang" },
  ];
  await writeFile(file, lines.map((entry) => JSON.stringify(entry)).join("\n"));
  return file;
}

const pools: TaskPool[] = [];
interface Started {
  pool: TaskPool;
  id: TaskId;
  states: TaskState[];
  inputLog: string;
  fixtureDir: string;
}

async function start(fixture: string, options: { forkFixture?: string; worktree?: boolean } = {}): Promise<Started> {
  const fixtureDir = path.dirname(fixture);
  const inputLog = path.join(fixtureDir, "input.log");
  const states: TaskState[] = [];
  const worktreeDir = path.join(fixtureDir, "wt");
  const pool = new TaskPool({
    registry: new TaskRegistry(path.join(fixtureDir, "tasks.json")),
    getSettings: async () => settings,
    buildLaunch: async (record, project) => ({
      command: process.execPath,
      args: [
        fakeOmp,
        record.sessionFile !== null && record.sessionFile === FORK_FILE && options.forkFixture
          ? options.forkFixture
          : fixture,
        record.sessionFile === FORK_FILE ? path.join(fixtureDir, "fork-input.log") : inputLog,
      ],
      cwd: record.worktreePath ?? project.path,
      env: process.env,
    }),
    assignJob: () => {},
    worktrees: {
      create: async () => {
        await mkdir(worktreeDir, { recursive: true });
        return { path: worktreeDir, branch: "studio/x", base: "main" };
      },
      remove: async () => {},
    },
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
  const created = await pool.createTask({ projectId: project.id, ...(options.worktree && { worktree: true }) });
  await vi.waitFor(() => expect(states.findLast((s) => s.id === created.id)?.status).toBe("idle"), { timeout: 15_000 });
  await pool.sendPrompt(created.id, { text: USER_TEXT, whenBusy: "steer" });
  await vi.waitFor(
    async () => {
      expect(states.findLast((s) => s.id === created.id)?.status).toBe("idle");
      expect((await pool.openTask(created.id)).transcript.items.some((item) => item.kind === "message")).toBe(true);
    },
    { timeout: 15_000 },
  );
  return { pool, id: created.id, states, inputLog, fixtureDir };
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

const sentFrames = async (inputLog: string): Promise<Record<string, unknown>[]> =>
  (await readFile(inputLog, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line): Record<string, unknown> => JSON.parse(line));
const sentTypes = async (inputLog: string): Promise<string[]> =>
  (await sentFrames(inputLog)).map((frame) => String(frame["type"]));
const originalFile = (): string => String(baseState()["sessionFile"]);
const userMessages = (snapshot: TranscriptSnapshot) =>
  snapshot.transcript.items.flatMap((item) =>
    item.kind === "message" && item.message.role === "user" ? [item.message] : [],
  );

const forkTail = (): Entry[] => [
  expectIn("get_branch_messages", "g1"),
  response("g1", "get_branch_messages", { messages: [{ entryId: "u1", text: USER_TEXT }] }),
  expectIn("branch", "b1"),
  response("b1", "branch", { text: USER_TEXT, cancelled: false }),
  withFile(FORK_FILE),
  expectIn("switch_session", "s1"),
  response("s1", "switch_session", { cancelled: false }),
  withFile(originalFile()),
];

describe("forkTask：在原任务的进程上 branch 再切回，新任务拿新的会话文件", () => {
  it("新任务记新文件、同项目、同模型；原任务的记录和对话流不变；进程收到 branch 后又 switch_session 回原文件", async () => {
    const fixtureForFork = await fixtureAfterTurn(forkTail());
    const forkFixture = await forkedTaskFixture(path.dirname(fixtureForFork));
    const { pool, id, states, inputLog } = await start(fixtureForFork, { forkFixture });
    const before = pool.listSessionLinks().find((link) => link.id === id)?.sessionFile;
    const snapshotBefore = await pool.openTask(id);

    const forked = await pool.forkTask(id, null);

    expect(forked.text).toBe(USER_TEXT);
    expect(forked.task.id).not.toBe(id);
    expect(forked.task.projectId).toBe(states.findLast((s) => s.id === id)?.projectId);
    const links = pool.listSessionLinks();
    expect(links.find((link) => link.id === forked.task.id)?.sessionFile).toBe(FORK_FILE);
    // 原任务：会话文件记录没被分叉的文件覆盖，对话流没变，仍是空闲。
    expect(links.find((link) => link.id === id)?.sessionFile).toBe(before);
    expect(userMessages(await pool.openTask(id))).toEqual(userMessages(snapshotBefore));
    await vi.waitFor(() => expect(states.findLast((s) => s.id === id)?.status).toBe("idle"));

    const frames = await sentFrames(inputLog);
    const types = frames.map((frame) => String(frame["type"]));
    expect(types.indexOf("get_branch_messages")).toBeLessThan(types.indexOf("branch"));
    expect(types.indexOf("branch")).toBeLessThan(types.indexOf("switch_session"));
    expect(frames.find((frame) => frame["type"] === "branch")).toMatchObject({ entryId: "u1" });
    expect(frames.find((frame) => frame["type"] === "switch_session")).toMatchObject({ sessionPath: originalFile() });
    // 分叉期间的 get_state 应答（来自分叉文件）没有写进原任务的记录：上面的 before 断言已覆盖，这里再确认事件流里没出现。
    expect(states.some((s) => s.id === id && s.status === "error")).toBe(false);
  });

  it("按对话流里用户消息的 key 分叉：不存在的 key 拒绝，不发 branch", async () => {
    const { pool, id, inputLog } = await start(await fixtureAfterTurn(forkTail()));
    await expect(pool.forkTask(id, "nope")).rejects.toThrow(/not in the conversation/);
    expect(await sentTypes(inputLog)).not.toContain("branch");
  });

  it("omp 说还没安静（isSettled=false）时拒绝：branch 在 omp 里不会报 session_busy，必须自己查", async () => {
    const { pool, id, inputLog } = await start(
      await fixtureAfterTurn([withFile(originalFile(), { isSettled: false })]),
    );
    await expect(pool.forkTask(id, null)).rejects.toThrow(/session is busy/);
    await expect(pool.branchTask(id, "u1")).rejects.toThrow(/session is busy/);
    expect(await sentTypes(inputLog)).not.toContain("branch");
  });

  it("worktree 任务的分叉共用同一个 worktree；还有分叉在用时不能丢弃原任务的 worktree", async () => {
    const fixtureForFork = await fixtureAfterTurn(forkTail());
    const forkFixture = await forkedTaskFixture(path.dirname(fixtureForFork));
    const { pool, id } = await start(fixtureForFork, { forkFixture, worktree: true });

    const forked = await pool.forkTask(id, null);

    const original = pool.taskGitContext(id);
    const copy = pool.taskGitContext(forked.task.id);
    expect(copy.worktree).toEqual(original.worktree);
    expect(copy.cwd).toBe(original.cwd);
    await expect(pool.discardWorktree(id)).rejects.toThrow(/shared with another task/);
  });
});

describe("branchTask：就地回到一个节点", () => {
  it("branch 之后任务改记新文件，对话流换成新会话的历史，返回那条消息的文字", async () => {
    const userMessage = {
      role: "user",
      content: [{ type: "text", text: "更早的一条" }],
      attribution: "user",
      timestamp: 1,
    };
    const { pool, id, inputLog } = await start(
      await fixtureAfterTurn([
        expectIn("branch", "b1"),
        response("b1", "branch", { text: USER_TEXT, cancelled: false }),
        withFile(BRANCH_FILE),
        expectIn("get_messages_page", "p1"),
        response("p1", "get_messages_page", { messages: [userMessage] }),
      ]),
    );

    const result = await pool.branchTask(id, "u1");

    expect(result).toEqual({ text: USER_TEXT });
    expect((await sentFrames(inputLog)).find((frame) => frame["type"] === "branch")).toMatchObject({ entryId: "u1" });
    expect(pool.listSessionLinks().find((link) => link.id === id)?.sessionFile).toBe(BRANCH_FILE);
    expect(userMessages(await pool.openTask(id)).map((message) => message.content)).toEqual([userMessage.content]);
  });

  it("omp 取消（cancelled: true）时抛错，任务记录不变", async () => {
    const { pool, id } = await start(
      await fixtureAfterTurn([expectIn("branch", "b1"), response("b1", "branch", { text: "", cancelled: true })]),
    );
    const before = pool.listSessionLinks().find((link) => link.id === id)?.sessionFile;
    await expect(pool.branchTask(id, "u1")).rejects.toThrow(/cancelled/);
    expect(pool.listSessionLinks().find((link) => link.id === id)?.sessionFile).toBe(before);
  });
});

describe("getSessionTree", () => {
  it("get_tree 的原始树变成用户消息节点，叶子所在分支标出", async () => {
    const entry = (id: string, parentId: string | null, role: string, text: string) => ({
      entry: { type: "message", id, parentId, message: { role, content: [{ type: "text", text }] } },
      children: [] as unknown[],
    });
    const root = entry("a", null, "user", "第一问");
    const reply = entry("b", "a", "assistant", "答");
    const second = entry("c", "b", "user", "第二问");
    root.children.push(reply);
    reply.children.push(second);
    const { pool, id } = await start(
      await fixtureAfterTurn([expectIn("get_tree", "t1"), response("t1", "get_tree", { tree: [root], leafId: "c" })]),
    );

    const view = await pool.getSessionTree(id);

    expect(view.nodes.map((node) => [node.entryId, node.text, node.current])).toEqual([
      ["a", "第一问", false],
      ["c", "第二问", true],
    ]);
  });
});

describe("分叉/回溯要求整个会话安静：没改状态机的 `!命令`、`/btw` 也算在途", () => {
  const btwTopic = {
    id: "t1",
    leafId: "leaf",
    question: "q",
    answer: "",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
  };

  it("`!命令` 还在跑：分叉和回溯都以 SessionBusyError 拒绝，不发 get_branch_messages / branch", async () => {
    const { pool, id, inputLog } = await start(await fixtureAfterTurn([expectIn("bash", "x1")]));
    pool.runBash(id, "sleep 60").catch(() => {});
    await vi.waitFor(async () => expect(await sentTypes(inputLog)).toContain("bash"), { timeout: 10_000 });

    await expect(pool.forkTask(id, null)).rejects.toThrow(/session is busy/);
    await expect(pool.branchTask(id, "u1")).rejects.toThrow(/session is busy/);

    const types = await sentTypes(inputLog);
    expect(types).not.toContain("get_branch_messages");
    expect(types).not.toContain("branch");
  });

  it("`/btw` 提问还在跑：分叉和回溯都以 SessionBusyError 拒绝，不发 branch", async () => {
    const { pool, id, inputLog } = await start(
      await fixtureAfterTurn([
        expectIn("btw", "q1"),
        { kind: "out", frame: { type: "btw_record", record: btwTopic } },
        response("q1", "btw", { record: btwTopic }),
      ]),
    );
    await pool.askBtw(id, "q");

    await expect(pool.forkTask(id, null)).rejects.toThrow(/session is busy/);
    await expect(pool.branchTask(id, "u1")).rejects.toThrow(/session is busy/);

    const types = await sentTypes(inputLog);
    expect(types).not.toContain("get_branch_messages");
    expect(types).not.toContain("branch");
  });
});

describe("就地回溯在 branch 之后失败", () => {
  it("读新历史失败：抛错、进程被关掉，任务记录仍是原会话文件（不采用新文件）", async () => {
    const { pool, id, states } = await start(
      await fixtureAfterTurn([
        expectIn("branch", "b1"),
        response("b1", "branch", { text: USER_TEXT, cancelled: false }),
        withFile(BRANCH_FILE),
        expectIn("get_messages_page", "p1"),
        {
          kind: "out",
          frame: { id: "p1", type: "response", command: "get_messages_page", success: false, error: "boom" },
        },
      ]),
    );
    const before = pool.listSessionLinks().find((link) => link.id === id)?.sessionFile;

    await expect(pool.branchTask(id, "u1")).rejects.toThrow(/boom/);
    // 进程被关掉后任务回到 stopped；旧实现的 finally 会在这之前就把新文件写进记录。
    await vi.waitFor(() => expect(states.findLast((s) => s.id === id)?.status).toBe("stopped"), { timeout: 10_000 });

    expect(pool.listSessionLinks().find((link) => link.id === id)?.sessionFile).toBe(before);
    expect(before).not.toBe(BRANCH_FILE);
    expect(states.findLast((s) => s.id === id)?.status).toBe("stopped");
  }, 30_000); // close() 要等假 omp 超时（它 hang 着不理 stdin 关闭）再按进程树结束
});

describe("discardWorktree：已归档的分叉也算在用这个 worktree", () => {
  it("分叉被归档后丢弃原任务的 worktree 仍被拒绝", async () => {
    const fixtureForFork = await fixtureAfterTurn(forkTail());
    const forkFixture = await forkedTaskFixture(path.dirname(fixtureForFork));
    const { pool, id } = await start(fixtureForFork, { forkFixture, worktree: true });
    const forked = await pool.forkTask(id, null);
    await pool.archiveTask(forked.task.id);

    await expect(pool.discardWorktree(id)).rejects.toThrow(/shared with another task/);
  });
});

describe("goal create：空白目标", () => {
  it("只有空白的目标文字被拒绝，不发 goal 命令", async () => {
    const { pool, id, inputLog } = await start(await fixtureAfterTurn([]));

    await expect(pool.taskGoal(id, "create", "   \n\t ")).rejects.toThrow(/empty/);
    await expect(pool.taskGoal(id, "create")).rejects.toThrow(/empty/);

    expect(await sentTypes(inputLog)).not.toContain("goal");
  });
});
