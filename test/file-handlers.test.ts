import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileHandlers, parseFilesTarget, targetCwd } from "../src/main/ipc/file-handlers.ts";
import { filesTarget } from "../src/renderer/src/features/file-preview/files-target.ts";
import { draftKey, type ProjectId, type TaskId } from "../src/shared/ipc.ts";

// 默认文件夹（AppInfo.chatsDir）由主进程解析：这里指到临时目录；任务池不应被默认文件夹的请求碰到。
const mocks = vi.hoisted(() => ({
  chats: "",
  getTaskPool: async (): Promise<never> => {
    throw new Error("the default folder must not need the task pool");
  },
}));
const getTaskPool = vi.fn(mocks.getTaskPool);
vi.mock("../src/main/tasks/chats-dir.ts", () => ({ chatsDir: () => mocks.chats }));
vi.mock("../src/main/tasks/runtime.ts", () => ({ getTaskPool: () => getTaskPool() }));

const target = { kind: "defaultFolder" } as const;
let work = "";
let chats = "";

beforeEach(async () => {
  // 带空格和中文：用户目录可能是任何样子。
  work = await mkdtemp(path.join(tmpdir(), "omp 默认 文件夹 "));
  chats = path.join(work, "omp-studio", "对话 chats");
  mocks.chats = chats;
  getTaskPool.mockClear();
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

describe("filesTarget（渲染进程）", () => {
  it("任务键 / 有项目的草稿 / 默认文件夹的草稿各给一种目标，默认文件夹不带路径", () => {
    expect(filesTarget("t1" as TaskId)).toEqual({ kind: "task", taskId: "t1" });
    expect(filesTarget(draftKey("p1" as ProjectId))).toEqual({ kind: "project", projectId: "p1" });
    expect(filesTarget(draftKey(null))).toEqual({ kind: "defaultFolder" });
  });
});

describe("parseFilesTarget", () => {
  it("默认文件夹只认 kind，多余字段（比如渲染进程塞来的路径）被丢掉", () => {
    expect(parseFilesTarget({ kind: "defaultFolder" })).toEqual({ kind: "defaultFolder" });
    expect(parseFilesTarget({ kind: "defaultFolder", path: "C:\\Windows" })).toEqual({ kind: "defaultFolder" });
  });
  it("未知 kind 和非对象被拒绝", () => {
    expect(() => parseFilesTarget({ kind: "path", path: "C:\\" })).toThrow();
    expect(() => parseFilesTarget("defaultFolder")).toThrow();
  });
});

describe("默认文件夹的根目录", () => {
  it("targetCwd 直接给 chatsDir，不碰任务池，也不建目录", async () => {
    expect(await targetCwd(target)).toBe(chats);
    expect(getTaskPool).not.toHaveBeenCalled();
    expect(
      await stat(chats).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  it("目录还没建：列表为空、预览是 missing、`@` 补全没有候选；浏览不建目录", async () => {
    expect(await fileHandlers.listDirectory(target, "")).toEqual({ entries: [], truncated: false });
    expect(await fileHandlers.listDirectory(target, "子 目录")).toEqual({ entries: [], truncated: false });
    expect((await fileHandlers.readPreviewFile(target, "笔记.md")).kind).toBe("missing");
    expect(await fileHandlers.listProjectFiles(target, "")).toEqual([]);
    expect(
      await stat(chats).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  it("目录建好后列出内容、读到文件、补全出相对路径（空格和中文）", async () => {
    await mkdir(path.join(chats, "子 目录"), { recursive: true });
    await writeFile(path.join(chats, "笔记 一.md"), "# 标题\n");
    await writeFile(path.join(chats, "子 目录", "深层.txt"), "x\n");
    const root = await fileHandlers.listDirectory(target, "");
    expect(root.entries.map((entry) => entry.name)).toEqual(["子 目录", "笔记 一.md"]);
    expect((await fileHandlers.listDirectory(target, "子 目录")).entries.map((entry) => entry.name)).toEqual([
      "深层.txt",
    ]);
    const file = await fileHandlers.readPreviewFile(target, "笔记 一.md");
    expect(file.kind).toBe("text");
    // 落在根内的绝对路径照样可预览。
    expect((await fileHandlers.readPreviewFile(target, path.join(chats, "笔记 一.md"))).kind).toBe("text");
    // `@` 补全跳过名字里有空白的文件（引用会在空格处断开），其余照常补全。
    await writeFile(path.join(chats, "笔记二.md"), "x\n");
    expect(await fileHandlers.listProjectFiles(target, "笔记")).toEqual(["笔记二.md"]);
  });

  it("越界路径仍被拒绝（目录存在与否都一样）", async () => {
    await expect(fileHandlers.listDirectory(target, "..")).rejects.toThrow();
    await expect(fileHandlers.readPreviewFile(target, path.join("..", "x.txt"))).rejects.toThrow();
    await expect(fileHandlers.readPreviewFile(target, work)).rejects.toThrow();
    await mkdir(chats, { recursive: true });
    await writeFile(path.join(work, "外面.txt"), "secret\n");
    await expect(fileHandlers.listDirectory(target, path.join("..", ".."))).rejects.toThrow();
    await expect(fileHandlers.readPreviewFile(target, path.join("..", "..", "外面.txt"))).rejects.toThrow();
    await expect(fileHandlers.listDirectory(target, work)).rejects.toThrow();
    await expect(fileHandlers.listProjectFiles(target, "..\\外面")).rejects.toThrow();
  });
});
