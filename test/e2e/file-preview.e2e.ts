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
  await writeFile(
    path.join(project, "big.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#0b7a66"/><rect width="800" height="500" fill="#7a0b66"/></svg>',
  );
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

test("源码视图有语法颜色：md 源码里围栏代码块的语言也着色，html 源码同样", async () => {
  const { launched, project, cleanup } = await start();
  try {
    const { page } = launched;
    await writeFile(path.join(project, "code.md"), "# 标题\n\n```ts\nconst answer: number = 42; // 注释\n```\n");
    await writeFile(path.join(project, "code.html"), '<h1 class="title">hi</h1>\n<script>const x = 1;</script>\n');
    // 源码区里不同颜色的数目（高亮异步，加载完才只改颜色）。
    const colorCount = () =>
      page.getByTestId("file-preview-body").evaluate((root) => {
        const g = globalThis as unknown as { getComputedStyle(element: unknown): { color: string } };
        const spans = (root as unknown as { querySelectorAll(selector: string): ArrayLike<unknown> }).querySelectorAll(
          "pre span",
        );
        return new Set(Array.from(spans, (span) => g.getComputedStyle(span).color)).size;
      });
    await page.getByTestId("topbar-files").click();
    for (const file of ["code.md", "code.html"]) {
      await page.getByTestId("file-preview-page-files").click();
      await page.locator(`[data-testid="file-tree-row"][data-path="${file}"]`).click();
      await page.getByTestId("file-preview-mode-source").click();
      await expect.poll(colorCount, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    }
  } finally {
    await cleanup();
  }
});

test("svg 围栏画成图：颜色换成主题色，切主题重画；<> 看源码；画不出来退回源码", async () => {
  const { launched, project, cleanup } = await start();
  try {
    const { page } = launched;
    await page.evaluate(() => globalThis.studio.setTheme("light"));
    await writeFile(
      path.join(project, "figure.md"),
      [
        "```svg",
        '<svg viewBox="0 0 200 40"><rect width="200" height="40" rx="6" fill="var(--accent)"/>',
        '<text x="10" y="25" fill="var(--fg)">图</text></svg>',
        "```",
        "",
        "```svg",
        "这不是 svg",
        "```",
        "",
      ].join("\n"),
    );
    await page.getByTestId("topbar-files").click();
    await page.locator('[data-testid="file-tree-row"][data-path="figure.md"]').click();
    const [good, bad] = [0, 1].map((nth) => page.getByTestId("file-preview-body").getByTestId("codeblock").nth(nth));
    const figure = good!.getByTestId("codeblock-figure");
    await expect(figure).toBeVisible();
    // 真画出来了（<img> 加载失败时 naturalWidth 是 0），1 个单位 1px。
    await expect
      .poll(() => figure.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth))
      .toBe(200);
    const source = () => figure.evaluate((img) => decodeURIComponent((img as unknown as { src: string }).src));
    const accent = () =>
      page.evaluate(() => {
        const g = globalThis as unknown as {
          getComputedStyle(element: unknown): { getPropertyValue(name: string): string };
          document: { documentElement: unknown };
        };
        return g.getComputedStyle(g.document.documentElement).getPropertyValue("--accent").trim();
      });
    const light = await source();
    expect(light).not.toContain("var(");
    expect(light).toContain(`fill="${await accent()}"`);
    await page.evaluate(() => globalThis.studio.setTheme("dark"));
    await expect.poll(source).not.toBe(light);
    expect(await source()).toContain(`fill="${await accent()}"`);

    await good!.hover();
    await good!.getByTestId("codeblock-source").click();
    await expect(figure).toHaveCount(0);
    await expect(good!.locator("pre")).toContainText('fill="var(--accent)"');
    await good!.getByTestId("codeblock-source").click();
    await expect(figure).toBeVisible();

    await expect(bad!.getByTestId("codeblock-figure")).toHaveCount(0);
    await expect(bad!).toContainText(/这张图画不出来|couldn't be drawn/);
    await expect(bad!.locator("pre")).toContainText("这不是 svg");
  } finally {
    await cleanup();
  }
});

test("预览大图：适应窗口时缩小会更小、放大会更大；放大后按住拖动平移，图片本身不能被拖走", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await page.setViewportSize({ width: 1225, height: 756 });
    await page.getByTestId("topbar-files").click();
    await page.locator('[data-testid=file-tree-row][data-path="big.svg"]').click();
    const img = page.getByTestId("file-preview-image");
    await expect(img).toBeVisible();
    const width = async () => (await img.boundingBox())!.width;
    const fit = await width();
    expect(fit).toBeLessThan(1600);
    expect(await img.getAttribute("draggable")).toBe("false");

    // 起点是适应窗口时眼前的大小：缩小一步变小，再放大两步比适应窗口大。
    await page.getByRole("button", { name: "缩小" }).click();
    await expect.poll(width).toBeLessThan(fit);
    await page.getByRole("button", { name: "放大" }).click();
    await page.getByRole("button", { name: "放大" }).click();
    await expect.poll(width).toBeGreaterThan(fit);
    for (let i = 0; i < 6; i += 1) await page.getByRole("button", { name: "放大" }).click();

    // 按住往左上拖：外框滚到右下。
    const box = page.locator(".file-preview-image");
    const scroll = () =>
      box.evaluate((el) => {
        const node = el as unknown as { scrollLeft: number; scrollTop: number };
        return { left: node.scrollLeft, top: node.scrollTop };
      });
    expect(await scroll()).toEqual({ left: 0, top: 0 });
    const area = (await box.boundingBox())!;
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width / 2 - 120, area.y + area.height / 2 - 80, { steps: 5 });
    await page.mouse.up();
    expect(await scroll()).toEqual({ left: 120, top: 80 });
    await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
