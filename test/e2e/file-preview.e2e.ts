// 文件预览的端到端：项目目录里写 .md / .svg / .html / 二进制，经真实 IPC（readPreviewFile）读回，
// 断言分类、内容、绝对路径换算、越界拒绝和不存在。从工具卡点文件链接打开面板的用例在 subagent-lanes.e2e.ts。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { TaskId } from "../../src/shared/ipc.ts";
import { launchApp, openTaskRow, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const fixture = path.join(root, "fixtures", "rpc", "bash-tool.ndjson");

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#0b7a66"/></svg>';

interface Started {
  launched: LaunchedApp;
  taskId: TaskId;
  project: string;
  cleanup(): Promise<void>;
}

async function start(): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 预览 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  await writeFile(path.join(project, "notes.md"), "# 预览标题\n\n- 第一项\n- 第二项\n");
  await writeFile(path.join(project, "logo.svg"), svg);
  await writeFile(path.join(project, "page.html"), "<h1>hello page</h1>");
  await writeFile(path.join(project, "blob.bin"), Buffer.from([1, 2, 0, 3, 4]));
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture] }),
  });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  const { page } = launched;
  await page.evaluate(async () => {
    await globalThis.studio.setLocale("zh-CN");
    const added = await globalThis.studio.addProject();
    if (!added) throw new Error("addProject 没有返回项目");
    await globalThis.studio.createTask({ projectId: added.id });
  });
  await openTaskRow(page);
  await expect(page.getByTestId("composer-input")).toBeVisible();
  const taskId = await page.evaluate(async () => (await globalThis.studio.listTasks())[0]?.id);
  if (taskId === undefined) throw new Error("没有任务");
  return {
    launched,
    taskId,
    project,
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    },
  };
}

test("readPreviewFile 按类型返回内容，越界拒绝", async () => {
  const { launched, taskId, project, cleanup } = await start();
  try {
    const { page } = launched;
    const read = (rel: string) =>
      page.evaluate(([id, p]) => globalThis.studio.readPreviewFile(id as TaskId, p!), [taskId, rel]);

    const md = await read("notes.md");
    expect(md.kind).toBe("text");
    expect(md.text).toContain("# 预览标题");
    expect(md.canOpen).toBe(true);

    const image = await read("logo.svg");
    expect(image.kind).toBe("image");
    expect(image.dataUrl?.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(image.dataUrl!.split(",")[1]!, "base64").toString("utf8")).toBe(svg);
    // svg 不在系统默认打开白名单里：只能在文件夹中显示。
    expect(image.canOpen).toBe(false);

    const html = await read("page.html");
    expect(html.kind).toBe("html");
    expect(html.text).toContain("hello page");

    expect((await read("blob.bin")).kind).toBe("binary");
    expect((await read("nope.md")).kind).toBe("missing");

    // 落在 cwd 内的绝对路径换算成相对路径。
    const absolute = await read(path.join(project, "notes.md"));
    expect(absolute.kind).toBe("text");
    expect(absolute.path).toBe("notes.md");

    await expect(read("../outside.txt")).rejects.toThrow();
    await expect(read(path.join(os.tmpdir(), "x.txt"))).rejects.toThrow();
  } finally {
    await cleanup();
  }
});
