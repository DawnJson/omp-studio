// 顶栏任务标签的端到端（spec §4.6）：侧栏点任务开标签、已开的切过去；× / 中键 / Ctrl W 关标签 = 关掉这个任务的 omp 进程；
// Ctrl Tab / Ctrl Shift Tab 轮换；任务在等你时关标签先确认；重启应用后标签和当前标签都恢复，只有当前标签起进程。
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { TaskId } from "../../src/shared/ipc.ts";
import { expandSidebarFolders, launchApp, setLocale, testOmp, type LaunchedApp } from "./launch.ts";

const tabs = (page: Page) => page.getByTestId("task-tab");
const tab = (page: Page, id: TaskId) => page.locator(`[data-testid=task-tab][data-task-id="${id}"]`);
const activeTab = (page: Page) => page.locator("[data-testid=task-tab][data-active]");
const status = (page: Page, id: TaskId) =>
  page.evaluate(async (task) => (await globalThis.studio.listTasks()).find((t) => t.id === task)?.status, id);
const row = (page: Page, id: TaskId) => page.locator(`[data-testid=task-row] .sb-row-main[data-nav="task:${id}"]`);
/** e2e 的类型配置没有 DOM：页面里的元素只用到这几个成员。 */
interface Box {
  scrollWidth: number;
  clientWidth: number;
  getBoundingClientRect(): { width: number };
}
const overflows = (el: unknown) => (el as Box).scrollWidth > (el as Box).clientWidth;

/** 一个项目、三个任务（都还没起进程）；返回任务 id，按创建顺序。 */
async function seed(launched: LaunchedApp, project: string): Promise<TaskId[]> {
  const { page, app } = launched;
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await setLocale(page, "zh-CN");
  return page.evaluate(async () => {
    const added = await globalThis.studio.addProject();
    if (!added) throw new Error("addProject 没有返回项目");
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await globalThis.studio.createTask({ projectId: added.id })).id);
    return ids;
  }) as Promise<TaskId[]>;
}

test("侧栏点任务开标签、已开的切过去；Ctrl Tab 轮换；×、中键、Ctrl W 关标签并关进程；重启后恢复标签，只起当前的进程", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 任务标签 e2e-"));
  const project = path.join(work, "项目");
  const userData = path.join(work, "user data");
  await mkdir(project);
  await mkdir(userData);
  let launched = await launchApp({ STUDIO_TEST_OMP: testOmp("slash-status"), STUDIO_USER_DATA: userData });
  try {
    const [a, b, c] = await seed(launched, project);
    let { page } = launched;
    // 新任务草稿：只有一个草稿标签。
    await expect(page.getByTestId("task-tab-draft")).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    await expandSidebarFolders(page);

    for (const id of [a!, b!, c!]) await row(page, id).click();
    await expect(tabs(page)).toHaveCount(3);
    await expect(page.getByTestId("task-tab-draft")).toHaveCount(0);
    await expect(activeTab(page)).toHaveAttribute("data-task-id", c!);
    for (const id of [a!, b!, c!]) await expect.poll(() => status(page, id)).not.toBe("stopped");

    // 再点已开的：不新开，切过去；点标签同样切。
    await row(page, a!).click();
    await expect(tabs(page)).toHaveCount(3);
    await expect(activeTab(page)).toHaveAttribute("data-task-id", a!);
    await tab(page, b!).getByRole("tab").click();
    await expect(activeTab(page)).toHaveAttribute("data-task-id", b!);

    // Ctrl Tab / Ctrl Shift Tab：首尾相接。
    await page.keyboard.press("Control+Tab");
    await expect(activeTab(page)).toHaveAttribute("data-task-id", c!);
    await page.keyboard.press("Control+Tab");
    await expect(activeTab(page)).toHaveAttribute("data-task-id", a!);
    await page.keyboard.press("Control+Shift+Tab");
    await expect(activeTab(page)).toHaveAttribute("data-task-id", c!);

    // × 关当前（c，最右）：换到左边的 b；c 的进程关掉，任务还在侧栏。
    await tab(page, c!).hover();
    await tab(page, c!).getByTestId("task-tab-close").click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTab(page)).toHaveAttribute("data-task-id", b!);
    await expect.poll(() => status(page, c!)).toBe("stopped");
    await expect(row(page, c!)).toBeVisible();

    // 再点侧栏里的 c：重新开标签、起进程。
    await row(page, c!).click();
    await expect(tabs(page)).toHaveCount(3);
    await expect.poll(() => status(page, c!)).not.toBe("stopped");

    // 中键关不是当前的 a：当前标签不变。
    await tab(page, a!).click({ button: "middle" });
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTab(page)).toHaveAttribute("data-task-id", c!);
    await expect.poll(() => status(page, a!)).toBe("stopped");

    // 拖动换位置：c 拖到 b 左半边 -> c、b；再拖回 b 右边 -> b、c。
    await tab(page, c!).dragTo(tab(page, b!), { targetPosition: { x: 4, y: 8 } });
    await expect(tabs(page).nth(0)).toHaveAttribute("data-task-id", c!);
    await tab(page, c!).dragTo(tab(page, b!), {
      targetPosition: { x: (await tab(page, b!).boundingBox())!.width - 4, y: 8 },
    });
    await expect(tabs(page).nth(0)).toHaveAttribute("data-task-id", b!);
    await expect(activeTab(page)).toHaveAttribute("data-task-id", c!);

    // 空闲、看过的任务没有状态图标：标题贴着标签左边，不留图标的空位。
    const current = tab(page, c!);
    await expect.poll(() => status(page, c!)).toBe("idle");
    const left = async () =>
      ((await current.locator(".task-tab-name").boundingBox())!.x - (await current.boundingBox())!.x) | 0;
    expect(await left()).toBeLessThan(12);
    // 按钮只在悬停时出来（当前标签：重开会话 + ×），平时那块地方给标题；出来时占标题的地方，标签不变宽（拖起来时相邻标签不挪）。
    const restart = current.getByTestId("task-tab-restart");
    const close = current.getByTestId("task-tab-close");
    await page.getByTestId("composer-input").hover();
    await expect(restart).toBeHidden();
    await expect(close).toBeHidden();
    const width = (await current.boundingBox())!.width;
    await current.hover();
    await expect(restart).toBeVisible();
    await expect(close).toBeVisible();
    expect((await current.boundingBox())!.width).toBe(width);
    await tab(page, b!).hover();
    await expect(tab(page, b!).getByTestId("task-tab-close")).toBeVisible();
    await expect(tab(page, b!).getByTestId("task-tab-restart")).toHaveCount(0);

    // 重启：标签 b、c 和当前的 c 都回来；只有 c 起了进程，b 点到时才起。
    await launched.close();
    launched = await launchApp({ STUDIO_TEST_OMP: testOmp("slash-status"), STUDIO_USER_DATA: userData });
    page = launched.page;
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(0)).toHaveAttribute("data-task-id", b!);
    await expect(tabs(page).nth(1)).toHaveAttribute("data-task-id", c!);
    await expect(activeTab(page)).toHaveAttribute("data-task-id", c!);
    await expect.poll(() => status(page, c!)).not.toBe("stopped");
    expect(await status(page, b!)).toBe("stopped");
    await tab(page, b!).getByRole("tab").click();
    await expect.poll(() => status(page, b!)).not.toBe("stopped");

    // Ctrl W 关当前（b，最左）：换到右边的 c；关掉最后一个回到新任务草稿。
    await page.keyboard.press("Control+w");
    await expect(activeTab(page)).toHaveAttribute("data-task-id", c!);
    await expect.poll(() => status(page, b!)).toBe("stopped");
    await page.keyboard.press("Control+w");
    await expect(tabs(page)).toHaveCount(0);
    await expect(page.getByTestId("task-tab-draft")).toBeVisible();
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test("任务在等你确认时关标签先确认：取消不关，确认后停掉进程", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 任务标签 e2e-"));
  const project = path.join(work, "项目");
  await mkdir(project);
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("approval") });
  try {
    const { page, app } = launched;
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await setLocale(page, "zh-CN");
    await page.getByTestId("sidebar-open-folder").click();
    await page.getByTestId("composer-input").fill('用 bash 运行 python -c "print(1+1)",只运行这一条命令。');
    await page.keyboard.press("Enter");
    await expect(tabs(page)).toHaveCount(1, { timeout: 20_000 });
    const id = (await tabs(page).getAttribute("data-task-id")) as TaskId;
    await expect.poll(() => status(page, id), { timeout: 30_000 }).toBe("needs_you");

    const dialog = page.getByTestId("close-tab-dialog");
    await tab(page, id).hover();
    await tab(page, id).getByTestId("task-tab-close").click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(1);
    expect(await status(page, id)).toBe("needs_you");

    await page.keyboard.press("Control+w");
    await dialog.getByRole("button", { name: "停止并关闭" }).click();
    await expect(tabs(page)).toHaveCount(0);
    await expect.poll(() => status(page, id)).toBe("stopped");
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test("标签右键：重命名改任务标题；颜色画在标签和侧栏行上，重启后还在；关闭其他 / 右侧 / 全部", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 标签菜单 e2e-"));
  const project = path.join(work, "项目");
  const userData = path.join(work, "user data");
  await mkdir(project);
  await mkdir(userData);
  let launched = await launchApp({ STUDIO_TEST_OMP: testOmp("slash-status"), STUDIO_USER_DATA: userData });
  try {
    const [a, b, c] = await seed(launched, project);
    let { page } = launched;
    await expandSidebarFolders(page);
    for (const id of [a!, b!, c!]) await row(page, id).click();
    await expect(tabs(page)).toHaveCount(3);
    let menu = page.getByTestId("task-tab-menu");

    // 重命名：就地输入框，Enter 提交，侧栏标题跟着变；Esc 不改。
    await tab(page, a!).click({ button: "right" });
    await menu.getByTestId("task-tab-menu-rename").click();
    await page.getByTestId("task-tab-rename").fill("改过的 A");
    await page.keyboard.press("Enter");
    await expect(tab(page, a!)).toContainText("改过的 A");
    await expect(row(page, a!)).toContainText("改过的 A");
    await tab(page, a!).click({ button: "right" });
    await menu.getByTestId("task-tab-menu-rename").click();
    await page.getByTestId("task-tab-rename").fill("不要");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-tab-rename")).toHaveCount(0);
    await expect(tab(page, a!)).toContainText("改过的 A");

    // 颜色：选 3 号，标签和侧栏行都出竖条；当前选中的那一格带勾。
    await tab(page, b!).click({ button: "right" });
    await menu.getByTestId("task-tab-color-3").click();
    await expect(menu).toHaveCount(0);
    await expect(tab(page, b!).getByTestId("task-color")).toHaveAttribute("data-color", "3");
    await expect(
      page.locator(`[data-testid=task-row]:has([data-nav="task:${b}"]) [data-testid=task-color]`),
    ).toHaveAttribute("data-color", "3");
    await tab(page, b!).click({ button: "right" });
    await expect(menu.getByTestId("task-tab-color-3")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    // 重启后颜色还在。
    await launched.close();
    launched = await launchApp({ STUDIO_TEST_OMP: testOmp("slash-status"), STUDIO_USER_DATA: userData });
    page = launched.page;
    menu = page.getByTestId("task-tab-menu");
    await expect(tabs(page)).toHaveCount(3);
    await expect(tab(page, b!).getByTestId("task-color")).toHaveAttribute("data-color", "3");
    await expect(tab(page, a!).getByTestId("task-color")).toHaveCount(0);

    // 去掉颜色。
    await tab(page, b!).click({ button: "right" });
    await menu.getByTestId("task-tab-color-0").click();
    await expect(tab(page, b!).getByTestId("task-color")).toHaveCount(0);

    // 最右的标签上"关闭右侧"灰显；关闭右侧 / 其他 / 全部。
    await tab(page, c!).click({ button: "right" });
    await expect(menu.getByTestId("task-tab-menu-right")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await tab(page, a!).click({ button: "right" });
    await menu.getByTestId("task-tab-menu-right").click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(tab(page, a!)).toHaveCount(1);
    for (const id of [b!, c!]) await row(page, id).click();
    await tab(page, b!).click({ button: "right" });
    await menu.getByTestId("task-tab-menu-others").click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTab(page)).toHaveAttribute("data-task-id", b!);
    await tab(page, b!).click({ button: "right" });
    await menu.getByTestId("task-tab-menu-all").click();
    await expect(tabs(page)).toHaveCount(0);
    await expect(page.getByTestId("task-tab-draft")).toBeVisible();
    for (const id of [a!, b!, c!]) await expect.poll(() => status(page, id)).toBe("stopped");
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test("标签挤满收窄时，悬停不改任何标签的宽度（按钮盖在标题上）", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 标签悬停 e2e-"));
  const project = path.join(work, "项目");
  await mkdir(project);
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("slash-status") });
  try {
    const { page, app } = launched;
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await setLocale(page, "zh-CN");
    const ids = (await page.evaluate(async () => {
      const added = await globalThis.studio.addProject();
      if (!added) throw new Error("addProject 没有返回项目");
      const out: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const task = await globalThis.studio.createTask({ projectId: added.id });
        await globalThis.studio.renameTask(task.id, `SYNC: Switch the long task title number ${i}`);
        out.push(task.id);
      }
      return out;
    })) as TaskId[];
    await expandSidebarFolders(page);
    for (const id of ids) await row(page, id).click();
    await expect(tabs(page)).toHaveCount(5);
    // 挤满了但没到最窄（不滚动）：标签等比收窄、标题省略。之前悬停时给标签定宽会改掉它的弹性基准，
    // 悬停的那个缩下去、别的变宽（2026-11-25 所有者报的）。
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800));
    const name = tab(page, ids[2]!).locator(".task-tab-name");
    await expect.poll(() => name.evaluate(overflows)).toBe(true);
    const strip = page.locator(".task-tabs-strip");
    expect(await strip.evaluate(overflows)).toBe(false);

    const widths = () =>
      tabs(page).evaluateAll((els) => els.map((el) => (el as unknown as Box).getBoundingClientRect().width));
    await page.getByTestId("composer-input").hover();
    const before = await widths();
    for (const id of [ids[2]!, ids[4]!]) {
      await tab(page, id).hover();
      await expect(tab(page, id).getByTestId("task-tab-close")).toBeVisible();
      expect(await widths()).toEqual(before);
    }
    // 当前标签（最后开的）悬停有重开 + ×。
    await expect(tab(page, ids[4]!).getByTestId("task-tab-restart")).toBeVisible();
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
