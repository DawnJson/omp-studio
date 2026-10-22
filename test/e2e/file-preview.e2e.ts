// 文件预览的端到端：项目目录里写 .md / .svg / .html / 二进制，经真实 IPC（readPreviewFile）读回，
// 断言分类、内容、绝对路径换算、越界拒绝和不存在。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import type { TaskId } from "../../src/shared/ipc.ts";
import { launchApp, openTaskRow, testOmp, type LaunchedApp } from "./launch.ts";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#0b7a66"/></svg>';

interface Started {
  launched: LaunchedApp;
  taskId: TaskId;
  project: string;
  cleanup(): Promise<void>;
}

/** `fixtureFor`：给了就用它造回放录制（返回 `testOmp(...)` 的值），默认回放 slash-status。 */
async function start(fixtureFor?: (work: string, project: string) => Promise<string>): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 预览 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  await writeFile(path.join(project, "notes.md"), "# 预览标题\n\n- 第一项\n- 第二项\n");
  await writeFile(path.join(project, "logo.svg"), svg);
  await writeFile(path.join(project, "page.html"), "<h1>hello page</h1>");
  await writeFile(path.join(project, "blob.bin"), Buffer.from([1, 2, 0, 3, 4]));
  const launched = await launchApp({
    STUDIO_TEST_OMP: fixtureFor ? await fixtureFor(work, project) : testOmp("slash-status"),
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
      page.evaluate(
        ([id, p]) => globalThis.studio.readPreviewFile({ kind: "task", taskId: id as TaskId }, p!),
        [taskId, rel],
      );

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

test("工具卡片上的文件链接在右侧打开预览，Esc 关闭、焦点回到链接", async () => {
  // 录制 task.jsonl（omp 18.12.5）里 read 卡片的两个文件链接是 file:///E:/tern-probe/demo/…；
  // 换成任务目录，让 tests/test_all.py 指向真文件。录制在等第一条用户消息（第一个 send 事件），发出同样的文字才继续回放。
  const recordedPath = path.join(import.meta.dirname, "..", "..", "fixtures", "tsp", "task.jsonl");
  const recordedLines = (await readFile(recordedPath, "utf8")).split("\n").filter((line) => line.trim() !== "");
  const prompt = recordedLines
    .map((line) => JSON.parse(line) as { dir: string; body: { ev?: string; text?: string } })
    .find((entry) => entry.dir === "in" && entry.body.ev === "send")?.body.text;
  if (prompt === undefined) throw new Error("task.jsonl 里没有 send 事件");
  const { launched, cleanup } = await start(async (work, project) => {
    await mkdir(path.join(project, "tests"));
    await writeFile(path.join(project, "tests", "test_all.py"), "def test_links():\n    assert 链接内容\n");
    const fixture = path.join(work, "task-links.jsonl");
    const links = recordedLines.join("\n").replaceAll("file:///E:/tern-probe/demo/", `${pathToFileURL(project).href}/`);
    await writeFile(fixture, `${links}\n`);
    return testOmp(fixture);
  });
  try {
    const { page } = launched;
    await page.getByTestId("composer-input").fill(prompt);
    await page.getByTestId("composer-input").press("Enter");
    const link = page.locator('a.tsp-link[data-href$="tests/test_all.py"]').first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();
    const preview = page.getByTestId("file-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("file-preview-name")).toHaveText("test_all.py");
    await expect(page.getByTestId("file-preview-body")).toContainText("链接内容");
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(link).toBeFocused();
  } finally {
    await cleanup();
  }
});
