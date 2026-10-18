// 任务池 + 真实 worktree：createTask({worktree: true}) 让 omp 以 worktree 为 cwd；丢弃 worktree 会关进程、移除目录和分支并归档任务。
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StudioSettings, TaskId } from "../src/shared/ipc.ts";
import { createWorktree, removeWorktree } from "../src/main/git/worktree.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";
import { makeRepo, makeScratch, sh } from "./git-helpers.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const fixture = path.join(root, "fixtures", "rpc", "simple-reply.ndjson");
const settings: StudioSettings = {
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses: 6,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  yoloConfirmed: false,
};

let scratch: string;
const pools: TaskPool[] = [];
beforeAll(async () => {
  scratch = await makeScratch("task-worktree");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

async function setup(name: string) {
  const repo = await makeRepo(scratch, name);
  const launches: string[] = [];
  const removed: TaskId[] = [];
  const registry = new TaskRegistry(path.join(scratch, `${name}-tasks.json`));
  const pool = new TaskPool({
    registry,
    getSettings: async () => settings,
    buildLaunch: async (record, project) => {
      const cwd = record.worktreePath ?? project.path;
      launches.push(cwd);
      return { command: process.execPath, args: [fakeOmp, fixture], cwd, env: process.env };
    },
    assignJob: () => {},
    worktrees: {
      create: async (project) => {
        const wt = await createWorktree(project.path);
        return { path: wt.path, branch: wt.branch, base: wt.baseBranch };
      },
      remove: (project, worktreePath, branch) => removeWorktree(project.path, worktreePath, branch),
    },
    events: {
      state: () => {},
      transcript: () => {},
      notice: () => {},
      taskRemoved: (id) => removed.push(id),
      slashCommands: () => {},
      subagents: () => {},
    },
  });
  pools.push(pool);
  await pool.init();
  const project = await pool.ensureProject(repo);
  return { repo, pool, registry, project, launches, removed };
}

describe("worktree 任务", () => {
  it("worktree: true：记录里有 worktree，omp 在 worktree 里启动，任务目录指向它；不带标志的任务不受影响", async () => {
    const { repo, pool, registry, project, launches } = await setup("仓库 任务");
    const plain = await pool.createTask({ projectId: project.id });
    const task = await pool.createTask({ projectId: project.id, worktree: true });
    await pool.openTask(task.id);
    await pool.openTask(plain.id);

    const record = registry.findTask(task.id);
    expect(record?.worktreePath).not.toBeNull();
    expect(record).toMatchObject({ worktreeBase: "main", worktreeBranch: expect.stringMatching(/^studio\//) });
    expect(registry.findTask(plain.id)).toMatchObject({ worktreePath: null, worktreeBranch: null });
    expect(launches).toContain(record?.worktreePath);
    expect(launches).toContain(repo);
    expect(pool.taskCwd(task.id)).toBe(record?.worktreePath);
    expect(pool.taskCwd(plain.id)).toBe(repo);
    expect(pool.taskGitContext(task.id).worktree).toMatchObject({ base: "main" });
    expect(pool.taskGitContext(plain.id).worktree).toBeNull();
  });

  it("项目不是 git 仓库：创建被拒绝，不留下任务记录", async () => {
    const { pool, registry } = await setup("仓库 非git");
    const plainDir = path.join(scratch, "普通 目录");
    await mkdir(plainDir, { recursive: true });
    const plain = await pool.ensureProject(plainDir);
    await expect(pool.createTask({ projectId: plain.id, worktree: true })).rejects.toThrow(/git repository/);
    expect(registry.listTasks()).toHaveLength(0);
  });

  it("丢弃 worktree：目录和分支都没了，任务被归档并推送 taskRemoved，记录里的 worktree 字段清空", async () => {
    const { repo, pool, registry, project, removed } = await setup("仓库 丢弃");
    const task = await pool.createTask({ projectId: project.id, worktree: true });
    await pool.openTask(task.id);
    const wtPath = registry.findTask(task.id)?.worktreePath ?? "";

    await pool.discardWorktree(task.id);
    await expect(access(wtPath)).rejects.toThrow();
    expect(sh(repo, "branch", "--format=%(refname:short)")).toBe("main");
    expect(removed).toEqual([task.id]);
    expect(registry.findTask(task.id)).toMatchObject({ archived: true, worktreePath: null, worktreeBranch: null });
    expect(pool.referencedWorktreePaths(project.id)).toEqual([]);
  });
});
