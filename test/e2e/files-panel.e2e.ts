// 右侧文件面板的端到端（spec §4.27）：顶栏按钮 / Ctrl Shift E 打开，文件树懒加载、展开、键盘操作，点文件在同一面板的预览页里看，
// 一层 1500 项只画眼前的行，展开状态按任务记住，越界的 listDirectory 被拒绝。中英 × 深浅各截图到 screenshots/（files-*）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { TaskId } from "../../src/shared/ipc.ts";
import { launchApp, openTaskRow, screenshotsDir, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const fixture = path.join(root, "fixtures", "rpc", "bash-tool.ndjson");
const bigCount = 1500;

/** 页面里的元素：node 工程没有 DOM 类型，回调里只用到这几个成员。 */
interface DomNode {
  getAttribute(name: string): string | null;
  firstElementChild: { offsetHeight: number } | null;
  scrollTop: number;
  scrollHeight: number;
}

interface Started {
  launched: LaunchedApp;
  taskId: TaskId;
  cleanup(): Promise<void>;
}

async function start(): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 文件树 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(path.join(project, "src", "nested"), { recursive: true });
  await mkdir(path.join(project, "docs"));
  await mkdir(path.join(project, "big"));
  await mkdir(path.join(project, ".git"));
  await writeFile(path.join(project, "src", "alpha.ts"), "export const alpha = 1;\n");
  await writeFile(path.join(project, "src", "nested", "deep.md"), "# 深层标题\n\n正文\n");
  await writeFile(path.join(project, "docs", "guide.md"), "# 指南\n");
  await writeFile(path.join(project, "notes.md"), "# 笔记\n\n- 第一项\n");
  await writeFile(path.join(project, "Zeta.txt"), "zeta\n");
  await Promise.all(
    Array.from({ length: bigCount }, (_, i) => writeFile(path.join(project, "big", `file-${i}.txt`), `${i}\n`)),
  );
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
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    },
  };
}

const row = (page: Page, rel: string) => page.locator(`[data-testid=file-tree-row][data-path="${rel}"]`);

async function shoot(page: Page, state: string): Promise<void> {
  for (const [locale, scheme] of [
    ["zh-CN", "light"],
    ["zh-CN", "dark"],
    ["en", "light"],
    ["en", "dark"],
  ] as const) {
    await page.evaluate(
      async ({ locale, scheme }) => {
        await globalThis.studio.setLocale(locale);
        await globalThis.studio.setTheme(scheme);
      },
      { locale, scheme },
    );
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", locale);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(screenshotsDir, `files-${state}-${locale}-${scheme}.png`) });
  }
  await page.evaluate(async () => {
    await globalThis.studio.setLocale("zh-CN");
  });
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", "zh-CN");
}

test("顶栏按钮打开文件面板：目录在前文件在后、不列 .git，展开、点文件在同一面板预览，展开状态按任务记住", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    const pane = page.getByTestId("file-preview");
    const toggle = page.getByTestId("topbar-files");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(pane).toBeVisible();
    await expect(pane).toHaveAttribute("data-page", "files");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // 没打开过文件：预览页签不可点。
    await expect(page.getByTestId("file-preview-page-preview")).toBeDisabled();

    // 根目录：目录（big docs src）在前、文件（notes.md Zeta.txt）在后，按名排序；.git 不出现。
    const paths = page.locator("[data-testid=file-tree-row]");
    await expect(paths.first()).toBeVisible();
    await expect(page.getByTestId("file-tree")).toBeFocused();
    expect(
      await paths.evaluateAll((els) => els.map((el) => (el as unknown as DomNode).getAttribute("data-path"))),
    ).toEqual(["big", "docs", "src", "notes.md", "Zeta.txt"]);

    // 点目录展开（懒加载一层），再点收起。
    await row(page, "src").click();
    await expect(row(page, "src")).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "src/nested")).toBeVisible();
    await expect(row(page, "src/alpha.ts")).toBeVisible();
    await expect(row(page, "src/nested/deep.md")).toHaveCount(0);
    await row(page, "src").click();
    await expect(row(page, "src/alpha.ts")).toHaveCount(0);
    await row(page, "src").click();
    await expect(row(page, "src/alpha.ts")).toBeVisible();

    // 点文件：切到预览页，渲染 Markdown。
    await row(page, "notes.md").click();
    await expect(pane).toHaveAttribute("data-page", "preview");
    await expect(page.getByTestId("file-preview-name")).toHaveText("notes.md");
    await expect(page.getByTestId("file-preview-md")).toContainText("第一项");
    await shoot(page, "preview");

    // 回文件页：树还在，src 仍展开。
    await page.getByTestId("file-preview-page-files").click();
    await expect(pane).toHaveAttribute("data-page", "files");
    await expect(row(page, "src/alpha.ts")).toBeVisible();
    await expect(row(page, "notes.md")).toHaveAttribute("aria-selected", "true");

    // 关闭再打开：展开状态按任务记住。
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await toggle.click();
    await expect(row(page, "src/alpha.ts")).toBeVisible();
    await shoot(page, "tree");
    await toggle.click();
    await expect(pane).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("键盘：Ctrl Shift E 开关，↑↓ 移动，→ 展开 / 进入子项，← 收起 / 回父目录，Enter 打开文件，Esc 关闭", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    const pane = page.getByTestId("file-preview");
    const tree = page.getByTestId("file-tree");
    await page.keyboard.press("Control+Shift+E");
    await expect(pane).toBeVisible();
    await expect(tree).toBeFocused();
    const cursor = page.locator("[data-testid=file-tree-row][data-cursor]");
    await expect(cursor).toHaveCount(0);
    await expect(row(page, "big")).toBeVisible();

    // 第一次 ↓ 落在第一行 big；再 ↓ docs、↓ src。
    await page.keyboard.press("ArrowDown");
    await expect(cursor).toHaveAttribute("data-path", "big");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(cursor).toHaveAttribute("data-path", "src");
    // → 展开；再 → 进入第一个子项（目录 nested）；→ 展开它；→ 进入 deep.md；→ 文件上无动作。
    await page.keyboard.press("ArrowRight");
    await expect(row(page, "src")).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "src/nested")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(cursor).toHaveAttribute("data-path", "src/nested");
    await page.keyboard.press("ArrowRight");
    await expect(row(page, "src/nested/deep.md")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(cursor).toHaveAttribute("data-path", "src/nested/deep.md");
    await page.keyboard.press("ArrowRight");
    await expect(cursor).toHaveAttribute("data-path", "src/nested/deep.md");
    // ← 在文件上回到父目录；← 收起它；← 再回上一层父目录。
    await page.keyboard.press("ArrowLeft");
    await expect(cursor).toHaveAttribute("data-path", "src/nested");
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, "src/nested")).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, "src/nested/deep.md")).toHaveCount(0);
    await page.keyboard.press("ArrowLeft");
    await expect(cursor).toHaveAttribute("data-path", "src");
    // Enter 在目录上是展开 / 收起。
    await page.keyboard.press("Enter");
    await expect(row(page, "src")).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(row(page, "src")).toHaveAttribute("aria-expanded", "true");
    // End / Home。
    await page.keyboard.press("End");
    await expect(cursor).toHaveAttribute("data-path", "Zeta.txt");
    await page.keyboard.press("Home");
    await expect(cursor).toHaveAttribute("data-path", "big");
    // Enter 在文件上：同一面板切到预览页。
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(pane).toHaveAttribute("data-page", "preview");
    await expect(page.getByTestId("file-preview-name")).toHaveText("Zeta.txt");
    await expect(page.getByTestId("file-preview-body")).toContainText("zeta");

    // Esc 关闭面板；Ctrl Shift E 再开，回到文件页。
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await page.keyboard.press("Control+Shift+E");
    await expect(pane).toHaveAttribute("data-page", "files");
    await page.keyboard.press("Control+Shift+E");
    await expect(pane).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("一层上千项：只渲染眼前的行，滚到底能看到最后一项；越界的 listDirectory 被拒绝", async () => {
  const { launched, taskId, cleanup } = await start();
  try {
    const { page } = launched;
    await page.getByTestId("topbar-files").click();
    await row(page, "big").click();
    await expect(row(page, "big/file-0.txt")).toBeVisible();
    const rendered = await page.locator("[data-testid=file-tree-row]").count();
    expect(rendered).toBeLessThan(100);
    const tree = page.getByTestId("file-tree");
    const canvas = await tree.evaluate((el) => (el as unknown as DomNode).firstElementChild!.offsetHeight);
    expect(canvas).toBeGreaterThan(bigCount * 20);
    // file-1499.txt 按数字排序在 big 里最后一个（同层的 notes.md 等文件在 big 之后）。
    await tree.evaluate((el) => {
      const node = el as unknown as DomNode;
      node.scrollTop = node.scrollHeight;
    });
    await expect(row(page, "Zeta.txt")).toBeVisible();
    await expect(row(page, `big/file-${bigCount - 1}.txt`)).toBeVisible();
    await expect(row(page, "big/file-0.txt")).toHaveCount(0);

    const list = (dir: string) =>
      page.evaluate(
        ([id, d]) => globalThis.studio.listDirectory({ kind: "task", taskId: id as TaskId }, d!),
        [taskId, dir],
      );
    expect((await list("big")).entries).toHaveLength(bigCount);
    await expect(list("..")).rejects.toThrow();
    await expect(list(path.join("src", "..", ".."))).rejects.toThrow();
    await expect(list(os.tmpdir())).rejects.toThrow();
  } finally {
    await cleanup();
  }
});
