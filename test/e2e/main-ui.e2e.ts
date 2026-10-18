// 阶段 2.6 主界面返工的端到端：空状态（最近任务、输入框贴底）、输入框两层布局、模型选择对话框、用量行、侧栏搜索。
// 用 fixtures/rpc/session-stats 回放（不调真实模型）；中英 × 深浅各截图到 screenshots/。
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, screenshotsDir, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const fixture = path.join(root, "fixtures", "rpc", "session-stats.ndjson");

async function start(): Promise<{ launched: LaunchedApp; cleanup(): Promise<void> }> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 主界面 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture] }),
  });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await launched.page.getByTestId("empty-open-folder").click();
  await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
  return {
    launched,
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
}

/** 在渲染进程里对选择器命中的第一个元素执行一段函数源码（本工程的 e2e 类型检查没有 DOM 类型）。 */
function inPage<T>(page: Page, selector: string, fn: string): Promise<T> {
  return page.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return (${fn})(el); })()`,
  ) as Promise<T>;
}

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
    await page.screenshot({ path: path.join(screenshotsDir, `main-${state}-${locale}-${scheme}.png`) });
  }
}

/** 在草稿输入框里发出第一条消息，等这一轮跑完（用量行出现 = get_session_stats 的结果到了）。 */
async function sendFirst(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("composer-input");
  await input.fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("usage-tokens")).toBeVisible();
}

test("输入框：上面输入区、下面工具行，中间 1px 分隔线，控件和输入区之间有留白", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    const body = await page.locator(".composer-body").boundingBox();
    const tools = page.locator(".composer-tools");
    const toolsBox = await tools.boundingBox();
    expect(body && toolsBox && toolsBox.y - (body.y + body.height)).toBeGreaterThanOrEqual(0);
    expect(await inPage<string>(page, ".composer-tools", "(el) => getComputedStyle(el).borderTopWidth")).toBe("1px");
    // 模型胶囊和分隔线之间至少 8px（之前贴着输入文字，上边距太小）。
    const chip = await page.getByTestId("model-chip").boundingBox();
    expect(chip && toolsBox && chip.y - toolsBox.y).toBeGreaterThanOrEqual(8);
    // 主区面板四角都是圆角，右边和下边留空。
    const radii = await inPage<string[]>(
      page,
      '[data-testid="main-panel"]',
      "(el) => { const c = getComputedStyle(el); return [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius]; }",
    );
    expect(new Set(radii).size).toBe(1);
    expect(radii[0]).not.toBe("0px");
    const panelBox = await page.getByTestId("main-panel").boundingBox();
    const [width, height] = await page.evaluate<number[]>("[window.innerWidth, window.innerHeight]");
    expect(panelBox && width! - (panelBox.x + panelBox.width)).toBe(8);
    expect(panelBox && height! - (panelBox.y + panelBox.height)).toBe(8);
  } finally {
    await cleanup();
  }
});

test("空状态的最近任务、对话里的用量行、模型选择对话框；截图", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await sendFirst(page, "用一句中文回答：2+2 等于几？不要调用任何工具。");

    // 用量行：上下文占比 + 本会话 token + 费用（fixture 里是 9206 token、$0.00006513，上下文不到 1%）。
    const meter = page.getByTestId("usage-meter");
    await expect(meter).toBeVisible();
    await expect(page.getByTestId("context-meter")).toContainText(/0\.\d/);
    await expect(page.getByTestId("usage-tokens")).toContainText("9.2K");
    await expect(page.getByTestId("usage-cost")).toContainText("$0.0001");
    // 输入框仍在主区底部。
    const panel = await page.getByTestId("main-panel").boundingBox();
    const stack = await page.getByTestId("composer-stack").boundingBox();
    expect(panel && stack && panel.y + panel.height - (stack.y + stack.height)).toBeLessThanOrEqual(24);
    await shoot(page, "conversation");

    // 模型选择对话框：焦点进搜索框，Tab 在框内循环，Esc 关闭后焦点回到胶囊。
    const chip = page.getByTestId("model-chip");
    await chip.click();
    const picker = page.getByTestId("model-picker");
    await expect(picker).toBeVisible();
    await expect(page.getByTestId("model-search")).toBeFocused();
    await expect(page.getByTestId("model-option").first()).toBeVisible();
    const details = page.getByTestId("model-details");
    await expect(details).toContainText("1M");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(
        await inPage<boolean>(page, '[data-testid="model-picker"]', "(el) => el.contains(document.activeElement)"),
      ).toBe(true);
    }
    // 搜索过滤：不存在的词没有结果，清空后恢复。
    await page.getByTestId("model-search").fill("zzz-no-such-model");
    await expect(page.getByTestId("model-option")).toHaveCount(0);
    await page.getByTestId("model-search").fill("");
    await expect(page.getByTestId("model-option").first()).toBeVisible();
    await page.getByTestId("model-search").focus();
    await shoot(page, "model-picker");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(chip).toBeFocused();

    // 回到空状态：该项目最近的任务是可点的入口；历史会话列表不存在。
    await page.keyboard.press("Control+n");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    const recent = page.getByTestId("empty-task");
    await expect(recent).toHaveCount(1);
    await expect(recent.first()).toContainText("2+2");
    await expect(page.getByTestId("empty-session")).toHaveCount(0);
    await page.locator("[data-composer-input]").focus();
    await shoot(page, "empty");
    await recent.first().click();
    await expect(page.getByTestId("composer-stack")).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("侧栏：搜索框在最上，其次 [新任务][添加项目]；搜索过滤任务并列出匹配的历史会话", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await sendFirst(page, "用一句中文回答：2+2 等于几？不要调用任何工具。");
    const sidebar = page.getByTestId("sidebar");
    const search = page.getByTestId("sidebar-search");
    const newTask = page.getByTestId("sidebar-new-task");
    const addProject = page.getByTestId("sidebar-add-project");
    const [s, n, a, list] = await Promise.all([
      search.boundingBox(),
      newTask.boundingBox(),
      addProject.boundingBox(),
      sidebar.locator(".sb-list-host").boundingBox(),
    ]);
    expect(s && n && s.y + s.height <= n.y).toBe(true);
    // 两个按钮在同一行，都在项目列表上方。
    expect(n && a && Math.abs(n.y - a.y) <= 1 && n.x < a.x).toBe(true);
    expect(a && list && a.y + a.height <= list.y).toBe(true);

    await expect(page.getByTestId("task-row")).toHaveCount(1);
    await search.fill("zzz-no-match");
    await expect(page.getByTestId("task-row")).toHaveCount(0);
    await expect(sidebar).toContainText(/没有匹配|No matching/);
    // 历史会话：launchApp 造的假会话里有 "Fix the flaky login test on CI"。
    await search.fill("login");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(1);
    await expect(page.getByTestId("sidebar-session").first()).toContainText("Fix the flaky login test on CI");
    await shoot(page, "sidebar-search");
    // Esc 清空搜索，任务列表恢复。
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.getByTestId("task-row")).toHaveCount(1);
    await expect(page.getByTestId("sidebar-session")).toHaveCount(0);
    // 设置图标不再是太阳：齿轮轮廓是一条闭合路径加中心圆。
    await expect(sidebar.locator(".sb-settings svg path")).toHaveCount(1);
    await expect(sidebar.locator(".sb-settings svg circle")).toHaveCount(1);
  } finally {
    await cleanup();
  }
});
