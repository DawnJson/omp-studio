import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectId } from "../src/shared/ipc.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 注册表-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const newTask = (projectId: ProjectId) => ({
  projectId,
  sessionFile: null,
  title: "t",
  model: null,
  thinkingLevel: null,
});

describe("TaskRegistry（tasks.json）", () => {
  it("重启后项目和任务（含重命名、归档）原样恢复，目录和标题可以带空格和中文", async () => {
    const file = path.join(scratch, "a", "tasks.json");
    const first = new TaskRegistry(file);
    await first.load();
    const project = await first.addProject(path.join(scratch, "我的 项目"));
    const task = await first.addTask(newTask(project.id));
    await first.updateTask(task.id, { title: "重命名 后", archived: true, sessionFile: "x.jsonl" });

    const second = new TaskRegistry(file);
    await second.load();
    expect(second.listProjects()).toEqual([project]);
    expect(second.findTask(task.id)).toMatchObject({
      title: "重命名 后",
      archived: true,
      sessionFile: "x.jsonl",
      worktreePath: null,
    });
  });

  it("同一个目录只加一次（路径写法不同、Windows 上大小写不同也算同一个）", async () => {
    const registry = new TaskRegistry(path.join(scratch, "b.json"));
    const dir = path.join(scratch, "Proj");
    const one = await registry.addProject(dir);
    const two = await registry.addProject(path.join(dir, "..", "Proj"));
    expect(two.id).toBe(one.id);
    if (process.platform === "win32") expect((await registry.addProject(dir.toUpperCase())).id).toBe(one.id);
    expect(registry.listProjects()).toHaveLength(1);
  });

  it("按会话文件找任务，路径比较和项目一样规范化", async () => {
    const registry = new TaskRegistry(path.join(scratch, "c.json"));
    const project = await registry.addProject(scratch);
    const task = await registry.addTask({ ...newTask(project.id), sessionFile: path.join(scratch, "s", "one.jsonl") });
    expect(registry.findTaskBySessionFile(path.join(scratch, "s", ".", "one.jsonl"))?.id).toBe(task.id);
    expect(registry.findTaskBySessionFile(path.join(scratch, "s", "two.jsonl"))).toBeUndefined();
  });

  it("tasks.json 损坏时 load 抛错，而不是当成空表把用户的任务列表覆盖掉", async () => {
    const file = path.join(scratch, "bad.json");
    await writeFile(file, "{ not json");
    await expect(new TaskRegistry(file).load()).rejects.toThrow();
    await writeFile(file, JSON.stringify({ version: 2, projects: [], tasks: [] }));
    await expect(new TaskRegistry(file).load()).rejects.toThrow(/unsupported/);
    expect(await readFile(file, "utf8")).toContain('"version":2');
  });

  it("连续保存是串行的，写完后目录里没有残留的临时文件", async () => {
    const dir = path.join(scratch, "d");
    const registry = new TaskRegistry(path.join(dir, "tasks.json"));
    const project = await registry.addProject(scratch);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => registry.addTask({ ...newTask(project.id), title: `t${i}` })),
    );
    expect(await readdir(dir)).toEqual(["tasks.json"]);
    const reloaded = new TaskRegistry(path.join(dir, "tasks.json"));
    await reloaded.load();
    expect(reloaded.listTasks()).toHaveLength(10);
  });

  it("一次写盘失败只让那一次 save 失败，不连累后面的写入（目标是个目录时 rename 失败，换回去后恢复）", async () => {
    const file = path.join(scratch, "failing", "tasks.json");
    const registry = new TaskRegistry(file);
    await registry.addProject(scratch);
    // 把 tasks.json 位置占成一个非空目录：rename 覆盖目录会失败。
    await rm(file, { force: true });
    await mkdir(path.join(file, "x"), { recursive: true });
    await expect(registry.save()).rejects.toThrow();
    await rm(file, { recursive: true, force: true });
    await registry.save();
    const reloaded = new TaskRegistry(file);
    await reloaded.load();
    expect(reloaded.listProjects()).toHaveLength(1);
  });
});
