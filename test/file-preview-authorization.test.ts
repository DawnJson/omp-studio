import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewHandlers } from "../src/main/ipc/preview-handlers.ts";
import { readPreviewFile } from "../src/main/files/preview-file.ts";
import type { TaskId } from "../src/shared/ipc.ts";

const mocks = vi.hoisted(() => ({
  cwd: "",
  exists: true,
  choose: vi.fn(),
  buildMenu: vi.fn(),
  copy: vi.fn(),
  reveal: vi.fn(),
  menuAction: null as string | null,
  network: false,
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: (...args: unknown[]) => mocks.choose(...args) },
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
    taskWorkspaceDirs: () => [],
  }),
}));
vi.mock("../src/main/tasks/chats-dir.ts", () => ({ chatsDir: () => mocks.cwd }));

const target = { kind: "task", taskId: "t1" as TaskId } as const;
let scratch = "";
let requested = "";
let selected = "";
beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-preview-consent-"));
  mocks.cwd = path.join(scratch, "task");
  const outside = path.join(scratch, "outside");
  await Promise.all([mkdir(mocks.cwd), mkdir(outside)]);
  requested = path.join(outside, "requested.md");
  selected = path.join(outside, "选择 文档.md");
  await writeFile(requested, "# requested");
  await writeFile(selected, "# selected");
  mocks.exists = true;
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
  mocks.choose.mockReset().mockResolvedValue({ canceled: false, filePaths: [selected] });
});
afterEach(() => rm(scratch, { recursive: true, force: true, maxRetries: 10 }));

describe("单文件预览授权", () => {
  it("只返回系统框实际选中的文件，不开放请求文件或其兄弟的后续读取", async () => {
    const file = await previewHandlers.choosePreviewFile(target, requested);
    expect(file).toMatchObject({ kind: "text", path: selected, text: "# selected", canOpen: false });
    for (const file of [requested, selected]) await expect(readPreviewFile(mocks.cwd, file)).rejects.toThrow();
  });

  it("取消选择不读取文件，也不留下目录权限", async () => {
    mocks.choose.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await previewHandlers.choosePreviewFile(target, path.join(scratch, "missing.md"))).toBeNull();
    await expect(readPreviewFile(mocks.cwd, selected)).rejects.toThrow();
  });

  it.each(["note.md", "page.html", "image.svg", "data.bin"])("沿用文件类型分类：%s", async (name) => {
    const file = path.join(scratch, name);
    await writeFile(file, name.endsWith(".bin") ? Buffer.from([0, 1]) : "<h1>content</h1>");
    mocks.choose.mockResolvedValue({ canceled: false, filePaths: [file] });
    const kind = name.endsWith(".svg")
      ? "image"
      : name.endsWith(".html")
        ? "html"
        : name.endsWith(".bin")
          ? "binary"
          : "text";
    expect(await previewHandlers.choosePreviewFile(target, requested)).toMatchObject({
      kind,
      path: file,
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
  ])("请求路径不安全时不打开系统框：%s", async (file) => {
    await expect(previewHandlers.choosePreviewFile(target, file)).rejects.toThrow();
    expect(mocks.choose).not.toHaveBeenCalled();
  });

  it("系统框返回网络路径仍被拒绝", async () => {
    mocks.choose.mockResolvedValue({ canceled: false, filePaths: ["\\\\server\\share\\a.md"] });
    await expect(previewHandlers.choosePreviewFile(target, requested)).rejects.toThrow();
  });

  it("实际文件解析到网络路径时，在读取元数据或内容前拒绝", async () => {
    mocks.network = true;
    await expect(previewHandlers.choosePreviewFile(target, requested)).rejects.toThrow("local absolute paths");
  });

  it("选择期间任务被删除时不返回内容", async () => {
    mocks.choose.mockImplementation(async () => {
      mocks.exists = false;
      return { canceled: false, filePaths: [selected] };
    });
    await expect(previewHandlers.choosePreviewFile(target, requested)).rejects.toThrow("unknown task");
  });

  it("选择目录别名里的文件仍只返回所选文件", async () => {
    const link = path.join(mocks.cwd, "link");
    await symlink(path.dirname(selected), link, "junction");
    const alias = path.join(link, "选择 文档.md");
    // 父目录本身是已选目录的别名，仍只读取这个文件。
    mocks.choose.mockResolvedValue({ canceled: false, filePaths: [alias] });
    expect(await previewHandlers.choosePreviewFile(target, requested)).toMatchObject({
      text: "# selected",
      path: alias,
    });
  });

  it("选中的文件链接逃出其目录时仍被拒绝", async ({ skip }) => {
    const link = path.join(mocks.cwd, "link.md");
    try {
      await symlink(selected, link, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      skip();
      return;
    }
    mocks.choose.mockResolvedValue({ canceled: false, filePaths: [link] });
    await expect(previewHandlers.choosePreviewFile(target, requested)).rejects.toThrow("escapes");
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
