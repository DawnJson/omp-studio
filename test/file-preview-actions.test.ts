import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewHandlers } from "../src/main/ipc/preview-handlers.ts";
import { fileHandlers } from "../src/main/ipc/file-handlers.ts";
import { readPreviewFile } from "../src/main/files/preview-file.ts";
import type { TaskId } from "../src/shared/ipc.ts";

const mocks = vi.hoisted(() => ({
  cwd: "",
  workspaceDirs: [] as string[],
  exists: true,
  buildMenu: vi.fn(),
  copy: vi.fn(),
  reveal: vi.fn(),
  menuAction: null as string | null,
  network: false,
}));
vi.mock("electron", () => ({
  Menu: { buildFromTemplate: (...args: unknown[]) => mocks.buildMenu(...args) },
  clipboard: { writeText: (text: string) => mocks.copy(text) },
  shell: { showItemInFolder: (file: string) => mocks.reveal(file) },
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: async (file: string) => {
      if (!mocks.network) return actual.realpath(file);
      const base = process.platform === "win32" ? "\\\\server\\share" : "//server/share";
      return path.extname(file) === "" ? base : `${base}${path.sep}${path.basename(file)}`;
    },
    stat: (file: string) => {
      if (mocks.network) throw new Error("network stat must not run");
      return actual.stat(file);
    },
  };
});
vi.mock("../src/main/window/main-window.ts", () => ({ getMainWindow: () => ({}) }));
vi.mock("../src/main/window/preview-protocol.ts", () => ({ registerPreview: vi.fn(), releasePreview: vi.fn() }));
vi.mock("../src/main/settings/settings-store.ts", () => ({ resolveLocale: () => "zh-CN" }));
vi.mock("../src/main/tasks/runtime.ts", () => ({
  getTaskPool: async () => ({
    taskCwd: () => {
      if (!mocks.exists) throw new Error("unknown task");
      return mocks.cwd;
    },
    taskWorkspaceDirs: () => mocks.workspaceDirs,
  }),
}));
vi.mock("../src/main/tasks/chats-dir.ts", () => ({ chatsDir: () => mocks.cwd }));

const target = { kind: "task", taskId: "t1" as TaskId } as const;
let scratch = "";
let requested = "";
let selected = "";
beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-preview-actions-"));
  mocks.cwd = path.join(scratch, "task");
  const outside = path.join(scratch, "outside");
  await Promise.all([mkdir(mocks.cwd), mkdir(outside)]);
  requested = path.join(outside, "requested.md");
  selected = path.join(outside, "选择 文档.md");
  await writeFile(requested, "# requested");
  await writeFile(selected, "# selected");
  mocks.exists = true;
  mocks.workspaceDirs = [];
  mocks.network = false;
  mocks.menuAction = null;
  mocks.copy.mockReset();
  mocks.reveal.mockReset();
  mocks.buildMenu.mockReset().mockImplementation((items: { id?: string; click?: () => void }[]) => ({
    popup: ({ callback }: { callback: () => void }) => {
      items.find((item) => item.id === mocks.menuAction)?.click?.();
      callback();
    },
  }));
});
afterEach(() => rm(scratch, { recursive: true, force: true, maxRetries: 10 }));

describe("文件链接直接预览", () => {
  it("直接返回链接指向的目录外文件，原读取接口仍拒绝它和兄弟文件", async () => {
    const file = await previewHandlers.readLinkedPreviewFile(target.taskId, requested);
    expect(file).toMatchObject({ kind: "text", path: requested, text: "# requested", external: true, canOpen: false });
    for (const file of [requested, selected]) {
      await expect(readPreviewFile(mocks.cwd, file)).rejects.toThrow();
      await expect(fileHandlers.readPreviewFile(target, file)).rejects.toThrow();
    }
    await expect(fileHandlers.listDirectory(target, path.dirname(requested))).rejects.toThrow();
  });

  it("相对链接按任务目录解析，并返回绝对路径", async () => {
    const file = await previewHandlers.readLinkedPreviewFile(target.taskId, path.relative(mocks.cwd, requested));
    expect(file).toMatchObject({ kind: "text", path: requested, text: "# requested", external: true });
  });

  it("工作区内的文件沿用工作区读取，结果仍保留绝对路径", async () => {
    const inside = path.join(mocks.cwd, "inside.md");
    await writeFile(inside, "# inside");
    const file = await previewHandlers.readLinkedPreviewFile(target.taskId, "inside.md");
    expect(file).toMatchObject({ kind: "text", path: inside, text: "# inside" });
    expect(file.external).not.toBe(true);
  });

  it("已加入工作区的文件保留根下标和绝对路径", async () => {
    mocks.workspaceDirs = [path.dirname(requested)];
    const file = await previewHandlers.readLinkedPreviewFile(target.taskId, requested);
    expect(file).toMatchObject({ kind: "text", path: requested, text: "# requested", root: 1 });
    expect(file.external).not.toBe(true);
  });

  it("目录外文件不存在时返回缺失状态", async () => {
    const missing = path.join(scratch, "missing.md");
    expect(await previewHandlers.readLinkedPreviewFile(target.taskId, missing)).toMatchObject({
      kind: "missing",
      path: missing,
      external: true,
      canOpen: false,
    });
  });

  it.each(["note.md", "page.html", "image.svg", "data.bin"])("沿用文件类型分类：%s", async (name) => {
    const file = path.join(scratch, name);
    await writeFile(file, name.endsWith(".bin") ? Buffer.from([0, 1]) : "<h1>content</h1>");
    const kind = name.endsWith(".svg")
      ? "image"
      : name.endsWith(".html")
        ? "html"
        : name.endsWith(".bin")
          ? "binary"
          : "text";
    expect(await previewHandlers.readLinkedPreviewFile(target.taskId, file)).toMatchObject({
      kind,
      path: file,
      external: true,
      canOpen: false,
    });
  });

  it.each([
    "\\\\server\\share\\a.md",
    "//server/share/a.md",
    "\\\\?\\C:\\a.md",
    "\\\\.\\C:\\a.md",
    "C:",
    "C:relative.md",
    "bad\0path",
  ])("拒绝非本机或无效路径：%s", async (file) => {
    await expect(previewHandlers.readLinkedPreviewFile(target.taskId, file)).rejects.toThrow();
  });

  it("实际文件解析到网络路径时，在读取元数据或内容前拒绝", async () => {
    mocks.network = true;
    await expect(previewHandlers.readLinkedPreviewFile(target.taskId, requested)).rejects.toThrow(
      "local absolute paths",
    );
  });

  it("任务不存在时不返回内容", async () => {
    mocks.exists = false;
    await expect(previewHandlers.readLinkedPreviewFile(target.taskId, requested)).rejects.toThrow("unknown task");
  });

  it("工作区内的目录别名逃出根目录时仍被拒绝", async () => {
    const link = path.join(mocks.cwd, "link");
    await symlink(path.dirname(selected), link, "junction");
    const alias = path.join(link, "选择 文档.md");
    await expect(previewHandlers.readLinkedPreviewFile(target.taskId, alias)).rejects.toThrow("escapes");
  });

  it("工作区内的文件链接逃出根目录时仍被拒绝", async ({ skip }) => {
    const link = path.join(mocks.cwd, "link.md");
    try {
      await symlink(selected, link, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      skip();
      return;
    }
    await expect(previewHandlers.readLinkedPreviewFile(target.taskId, link)).rejects.toThrow("escapes");
  });
});

describe("原生文件右键菜单", () => {
  it("仅在用户选择菜单项后复制完整路径，不读取文件", async () => {
    mocks.menuAction = "copyPath";
    const missing = path.join(scratch, "missing.txt");
    await previewHandlers.showFileContextMenu(target, missing);
    expect(mocks.copy).toHaveBeenCalledWith(missing);
    expect(mocks.reveal).not.toHaveBeenCalled();
  });

  it("取消菜单没有副作用", async () => {
    await previewHandlers.showFileContextMenu(target, requested);
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.reveal).not.toHaveBeenCalled();
  });

  it("文件与目录都只在文件管理器中定位，不执行默认关联程序", async () => {
    mocks.menuAction = "reveal";
    await previewHandlers.showFileContextMenu(target, selected);
    await previewHandlers.showFileContextMenu(target, path.dirname(selected));
    expect(mocks.reveal).toHaveBeenCalledWith(selected);
    expect(mocks.reveal).toHaveBeenCalledWith(path.dirname(selected));
    await expect(readPreviewFile(mocks.cwd, selected)).rejects.toThrow();
  });

  it("网络路径既不显示菜单，也不触发文件管理器", async () => {
    await expect(previewHandlers.showFileContextMenu(target, "\\\\server\\share\\x")).rejects.toThrow();
    expect(mocks.buildMenu).not.toHaveBeenCalled();
    expect(mocks.reveal).not.toHaveBeenCalled();
  });
});
