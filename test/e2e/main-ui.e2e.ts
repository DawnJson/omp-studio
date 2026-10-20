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
  await launched.page.getByTestId("sidebar-add-project").click();
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
    // 关掉入场动画再量：动画中途的 transform 会让位置差零点几像素。
    await page.emulateMedia({ reducedMotion: "reduce" });
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

test("没有项目时直接发送：在 chats 目录里建项目和任务，侧栏出现这个项目；截图", async () => {
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture] }),
  });
  try {
    const { page, userDataDir } = launched;
    const chats = path.join(userDataDir, "chats");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "no-project");
    // 草稿页 = 新任务：侧栏按钮标为当前。
    await expect(page.getByTestId("sidebar-new-task")).toHaveAttribute("aria-current", "page");
    await page.locator("[data-composer-input]").focus();
    await shoot(page, "no-project");

    await sendFirst(page, "用一句中文回答：2+2 等于几？不要调用任何工具。");
    const projects = await page.evaluate(() => globalThis.studio.listProjects());
    expect(projects.map((project) => path.resolve(project.path))).toEqual([path.resolve(chats)]);
    await expect(page.getByTestId("task-row")).toHaveCount(1);
    await expect(page.getByTestId("sidebar")).toContainText("chats");
    await expect(page.getByTestId("sidebar-new-task")).not.toHaveAttribute("aria-current", "page");

    // 之后 Ctrl N 回到的是 chats 这个普通项目的草稿页。
    await page.keyboard.press("Control+n");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    await expect(page.getByTestId("empty-project")).toContainText("chats");
  } finally {
    await launched.close();
  }
});

test("空状态的最近任务、对话里的用量行、模型选择对话框；截图", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    // 新任务草稿：还没有会话，发送键左边是上下文圆环（0%，只有圆、没有文字，窗口取默认模型的）和 $0.00；没有本会话 token。
    const draft = page.getByTestId("draft-composer");
    await expect(draft.getByTestId("context-meter")).toHaveAttribute("aria-label", /0%/);
    await expect(draft.getByTestId("context-meter")).toHaveText("");
    await expect(draft.getByTestId("usage-tokens")).toHaveCount(0);
    await expect(draft.getByTestId("usage-cost")).toHaveText("$0.00");
    await expect(page.getByTestId("model-chip").locator("svg")).toHaveCount(0);
    await sendFirst(page, "用一句中文回答：2+2 等于几？不要调用任何工具。");

    // 输入框下方不再有单独一行：模型胶囊右边是本会话 token（fixture 9206）；发送键左边依次是上下文圆环
    // （fixture 上下文不到 1%，没有文字）和费用 $0.00006513，每日用量和额度在费用的浮层里。
    const tools = page.locator(".composer-tools");
    const meter = tools.getByTestId("usage-meter");
    await expect(meter).toBeVisible();
    await expect(meter.getByTestId("usage-tokens")).toContainText("9.2K");
    const chipBox = await page.getByTestId("model-chip").boundingBox();
    const tokensBox = await meter.getByTestId("usage-tokens").boundingBox();
    expect(tokensBox?.x ?? 0).toBeGreaterThanOrEqual((chipBox?.x ?? 0) + (chipBox?.width ?? 0));
    const contextMeter = tools.getByTestId("context-meter");
    await expect(contextMeter).toHaveAttribute("aria-label", /0\.\d/);
    await expect(contextMeter).toHaveText("");
    await expect(page.locator(".composer-stack > [data-testid=usage-meter]")).toHaveCount(0);
    const cost = tools.getByTestId("usage-cost");
    await expect(cost).toContainText("$0.0001");
    const [contextBox, costBox, sendBox] = await Promise.all(
      [contextMeter, cost, page.getByTestId("send-button")].map((locator) => locator.boundingBox()),
    );
    // 同一行，从左到右：本会话 token、圆环、费用、发送键；圆环和模型胶囊垂直中线对齐。
    expect(contextBox && tokensBox && contextBox.x).toBeGreaterThanOrEqual(
      (tokensBox?.x ?? 0) + (tokensBox?.width ?? 0),
    );
    expect(contextBox && costBox && contextBox.x + contextBox.width).toBeLessThanOrEqual(costBox?.x ?? 0);
    expect(costBox && sendBox && costBox.x + costBox.width).toBeLessThanOrEqual(sendBox?.x ?? 0);
    expect(
      chipBox && contextBox && Math.abs(chipBox.y + chipBox.height / 2 - (contextBox.y + contextBox.height / 2)),
    ).toBeLessThanOrEqual(2);
    // 输入框仍在主区底部。
    const panel = await page.getByTestId("main-panel").boundingBox();
    const stack = await page.getByTestId("composer-stack").boundingBox();
    expect(panel && stack && panel.y + panel.height - (stack.y + stack.height)).toBeLessThanOrEqual(24);
    await shoot(page, "conversation");

    // 上下文构成：系统提示词、工具定义（估算）、消息、剩余空间各一行（自动压缩预留要读 omp 设置，测试环境里不一定有）；
    // Esc 关闭后焦点回到圆环。
    await page.getByTestId("context-meter").click();
    const breakdown = page.getByTestId("context-breakdown");
    await expect(breakdown).toBeVisible();
    for (const part of ["system", "tools", "messages", "free"])
      await expect(breakdown.locator(`[data-testid="context-row"][data-part="${part}"]`)).toHaveCount(1);
    // 构成下面不再有说明小字。
    await expect(breakdown.locator(".ctx-note")).toHaveCount(0);
    await shoot(page, "context");
    await page.keyboard.press("Escape");
    await expect(breakdown).toHaveCount(0);
    await expect(page.getByTestId("context-meter")).toBeFocused();

    // 本会话按模型的明细。
    await page.getByTestId("usage-tokens").click();
    await expect(page.getByTestId("model-breakdown")).toBeVisible();
    await shoot(page, "model-usage");
    await page.keyboard.press("Escape");
    // 点费用：居中的对话框（不是贴着按钮的浮层），顶上是"订阅额度 / 每日用量"切换框，默认订阅额度，←/→ 切页；
    // 没有"去设置看全年"；Esc 关闭后焦点回到费用。
    await cost.click();
    const overview = page.getByRole("dialog", { name: /用量与额度|Usage and quota/ });
    await expect(overview).toBeVisible();
    await expect(overview.getByTestId("usage-tab-quota")).toHaveAttribute("aria-selected", "true");
    await expect(overview.getByTestId("quota-section")).toBeVisible();
    await expect(overview.getByTestId("heatmap-section")).toHaveCount(0);
    await overview.getByTestId("usage-tab-quota").focus();
    await page.keyboard.press("ArrowRight");
    await expect(overview.getByTestId("usage-tab-daily")).toBeFocused();
    await expect(overview.getByTestId("heatmap-section")).toBeVisible();
    await expect(overview.getByTestId("quota-section")).toHaveCount(0);
    // 每日用量只按花费看：没有 token / 花费 / 请求数切换。对话框在窗口正中。
    await expect(overview.getByTestId("usage-metric")).toHaveCount(0);
    const dialogBox = await overview.boundingBox();
    const viewport = (await page.evaluate("({ width: innerWidth, height: innerHeight })")) as {
      width: number;
      height: number;
    };
    expect(Math.abs((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0) / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
    await expect(overview.getByRole("button", { name: /设置|Settings/ })).toHaveCount(0);
    await shoot(page, "quota");
    await page.keyboard.press("Escape");
    await expect(overview).toHaveCount(0);
    await expect(cost).toBeFocused();

    // 模型选择对话框：焦点进搜索框，Tab 在框内循环，Esc 关闭后焦点回到胶囊。
    const chip = page.getByTestId("model-chip");
    await chip.click();
    const picker = page.getByTestId("model-picker");
    await expect(picker).toBeVisible();
    await expect(page.getByTestId("model-search")).toBeFocused();
    // 按 provider 分组，默认折叠：只有组头；↓ 到组头、Enter 展开。
    const group = page.getByTestId("model-group").first();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("model-option")).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("model-option").first()).toBeVisible();
    // 右栏是正在生效的模型的参数（照终端版 omp）：上下文按完整数字显示。
    const details = page.getByTestId("model-details");
    await expect(details).toContainText("1,000,000");
    await expect(page.getByTestId("model-speed")).not.toHaveText("…");
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
