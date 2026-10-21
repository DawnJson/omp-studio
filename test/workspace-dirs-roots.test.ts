// 任务的额外工作区目录（`/add-dir`）：文件面板可以把它们当额外的根。
// 防的是：渲染进程（被注入时）借"根下标"读到任务 cwd 和已登记的工作区目录之外的文件——下标越界 / 过期、`..`、绝对路径、符号链接都不行；
// 路径带空格和中文。根的绝对路径只来自主进程记的列表（omp 的输出），渲染进程传来的 root 字段只能是整数。
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileHandlers, parseFilesTarget, targetCwd } from "../src/main/ipc/file-handlers.ts";
import { parseRootIndex, rootDir } from "../src/main/files/task-roots.ts";
import { WorkspaceDirs } from "../src/main/tasks/workspace-dirs.ts";
import type { TaskId } from "../src/shared/ipc.ts";

const mocks = vi.hoisted(() => ({ cwd: "", dirs: [] as string[] }));
vi.mock("../src/main/tasks/chats-dir.ts", () => ({ chatsDir: () => "" }));
vi.mock("../src/main/tasks/runtime.ts", () => ({
  getTaskPool: async () => ({
    taskCwd: () => mocks.cwd,
    taskWorkspaceDirs: () => mocks.dirs,
    listProjects: () => [],
  }),
}));

const task = "t1" as TaskId;
let work = "";
let cwd = "";
let extra = "";
let outside = "";

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "omp 工作区 "));
  cwd = path.join(work, "项目 a");
  extra = path.join(work, "额外 目录");
  outside = path.join(work, "外面");
  for (const dir of [cwd, extra, outside]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(cwd, "a.txt"), "cwd file");
  await writeFile(path.join(extra, "笔记 一.md"), "extra file");
  await writeFile(path.join(outside, "secret.txt"), "secret");
  mocks.cwd = cwd;
  mocks.dirs = [extra];
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

describe("根下标", () => {
  it("parseRootIndex：缺省是 0，只认 0…64 的整数", () => {
    expect(parseRootIndex(undefined)).toBe(0);
    expect(parseRootIndex(3)).toBe(3);
    for (const bad of [-1, 65, 1.5, "1", null, NaN, { toString: () => "1" }, "C:\\Windows"])
      expect(() => parseRootIndex(bad)).toThrow();
  });

  it("rootDir：0 = cwd；n = 列表第 n 项；过期下标抛错而不是落到别的根", () => {
    expect(rootDir(cwd, [extra], 0)).toBe(cwd);
    expect(rootDir(cwd, [extra], 1)).toBe(extra);
    expect(() => rootDir(cwd, [extra], 2)).toThrow("unknown workspace directory");
    expect(() => rootDir(cwd, [], 1)).toThrow("unknown workspace directory");
    expect(() => rootDir(cwd, ["relative/dir"], 1)).toThrow("absolute");
  });

  it("parseFilesTarget：渲染进程给不了绝对根——root 只能是整数，多余字段被丢掉", () => {
    expect(parseFilesTarget({ kind: "task", taskId: "t1" })).toEqual({ kind: "task", taskId: "t1" });
    expect(parseFilesTarget({ kind: "task", taskId: "t1", root: 0 })).toEqual({ kind: "task", taskId: "t1" });
    expect(parseFilesTarget({ kind: "task", taskId: "t1", root: 2 })).toEqual({ kind: "task", taskId: "t1", root: 2 });
    expect(parseFilesTarget({ kind: "task", taskId: "t1", root: 1, path: "C:\\Windows" })).toEqual({
      kind: "task",
      taskId: "t1",
      root: 1,
    });
    expect(() => parseFilesTarget({ kind: "task", taskId: "t1", root: "C:\\Windows" })).toThrow();
    expect(() => parseFilesTarget({ kind: "task", taskId: "t1", root: extra })).toThrow();
    // 草稿的项目 / 默认文件夹没有额外根：root 被丢掉。
    expect(parseFilesTarget({ kind: "defaultFolder", root: 1 })).toEqual({ kind: "defaultFolder" });
  });
});

describe("文件面板读额外根", () => {
  it("root 缺省 / 0 读任务 cwd；root 1 读额外目录（空格和中文）", async () => {
    expect(await targetCwd({ kind: "task", taskId: task })).toBe(cwd);
    expect(await targetCwd({ kind: "task", taskId: task, root: 1 })).toBe(extra);
    const listing = await fileHandlers.listDirectory({ kind: "task", taskId: task, root: 1 }, "");
    expect(listing.entries.map((entry) => entry.name)).toEqual(["笔记 一.md"]);
    const file = await fileHandlers.readPreviewFile({ kind: "task", taskId: task, root: 1 }, "笔记 一.md");
    expect(file).toMatchObject({ kind: "text", text: "extra file" });
  });

  it("下标过期（目录被移除）：reject，不会读到 cwd", async () => {
    mocks.dirs = [];
    await expect(fileHandlers.listDirectory({ kind: "task", taskId: task, root: 1 }, "")).rejects.toThrow(
      "unknown workspace directory",
    );
    await expect(fileHandlers.readPreviewFile({ kind: "task", taskId: task, root: 1 }, "笔记 一.md")).rejects.toThrow();
  });

  it("额外根里：.. 越界、绝对路径、盘符路径都被拒绝（不泄露兄弟目录和 cwd 的文件）", async () => {
    const t = { kind: "task", taskId: task, root: 1 } as const;
    for (const bad of [
      "..\\外面\\secret.txt",
      "../外面/secret.txt",
      "../项目 a/a.txt",
      path.join(outside, "secret.txt"),
      path.join(cwd, "a.txt"),
      "C:secret.txt",
    ]) {
      await expect(fileHandlers.readPreviewFile(t, bad)).rejects.toThrow();
    }
    await expect(fileHandlers.listDirectory(t, "..")).rejects.toThrow();
    await expect(fileHandlers.listDirectory(t, "../外面")).rejects.toThrow();
  });

  it("cwd 根里也读不到额外目录或兄弟目录的相对路径越界", async () => {
    const t = { kind: "task", taskId: task } as const;
    await expect(fileHandlers.readPreviewFile(t, "..\\额外 目录\\笔记 一.md")).rejects.toThrow();
    await expect(fileHandlers.listDirectory(t, "../额外 目录")).rejects.toThrow();
  });

  it("额外根里的符号链接（junction）指向根外：不列、不读；指向根内才行", async () => {
    let linked = true;
    await symlink(outside, path.join(extra, "escape"), "junction").catch(() => (linked = false));
    await symlink(cwd, path.join(extra, "to-cwd"), "junction").catch(() => (linked = false));
    await mkdir(path.join(extra, "real"));
    await writeFile(path.join(extra, "real", "ok.txt"), "ok");
    await symlink(path.join(extra, "real"), path.join(extra, "inner"), "junction").catch(() => (linked = false));
    if (!linked) return; // 没有创建链接的权限时只测上面的词法部分
    const t = { kind: "task", taskId: task, root: 1 } as const;
    const names = (await fileHandlers.listDirectory(t, "")).entries.map((entry) => entry.name);
    expect(names).toContain("inner");
    expect(names).not.toContain("escape");
    expect(names).not.toContain("to-cwd");
    await expect(fileHandlers.listDirectory(t, "escape")).rejects.toThrow();
    await expect(fileHandlers.readPreviewFile(t, "escape/secret.txt")).rejects.toThrow();
    await expect(fileHandlers.readPreviewFile(t, "to-cwd/a.txt")).rejects.toThrow();
    expect(await fileHandlers.readPreviewFile(t, "inner/ok.txt")).toMatchObject({ kind: "text", text: "ok" });
  });
});

// omp 18.12.5 的实测输出（用户目录换成 C:\Users\u）。
describe("WorkspaceDirs（主进程记的列表）", () => {
  const out = (body: string) => `Workspace directories:\n  C:\\w\\proj (working directory)${body}`;

  it("按 omp 的输出更新；没变化返回 false", () => {
    const dirs = new WorkspaceDirs();
    expect(dirs.apply(out(""))).toBe(false);
    expect(dirs.apply(`Added C:\\a b\\中文.\n${out("\n  C:\\a b\\中文")}`)).toBe(true);
    expect(dirs.dirs).toEqual(["C:\\a b\\中文"]);
    expect(dirs.apply(out("\n  C:\\a b\\中文"))).toBe(false);
    expect(dirs.apply(`Removed C:\\a b\\中文.\n${out("")}`)).toBe(true);
    expect(dirs.dirs).toEqual([]);
  });

  it("omp 拒绝或输出认不出来：以原文抛错，列表不变", () => {
    const dirs = new WorkspaceDirs();
    dirs.apply(out("\n  C:\\x"));
    expect(() => dirs.apply("Directory does not exist: C:\\nope")).toThrow("Directory does not exist: C:\\nope");
    expect(() => dirs.apply("Already in the workspace: C:\\x")).toThrow("Already in the workspace");
    expect(() => dirs.apply("something else")).toThrow("something else");
    expect(() => dirs.apply("")).toThrow("omp returned no output");
    expect(dirs.dirs).toEqual(["C:\\x"]);
  });

  it("进程退出后清空", () => {
    const dirs = new WorkspaceDirs();
    dirs.apply(out("\n  C:\\x"));
    expect(dirs.reset()).toBe(true);
    expect(dirs.reset()).toBe(false);
    expect(dirs.dirs).toEqual([]);
  });
});
