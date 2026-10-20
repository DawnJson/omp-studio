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
  await launched.page.getByTestId("sidebar-open-folder").click();
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

/** 在草稿输入框里发出第一条消息，等这一轮跑完（费用从 $0.00 变成 fixture 的值 = get_session_stats 的结果到了）。 */
async function sendFirst(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("composer-input");
  await input.fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("composer-stack").getByTestId("usage-cost")).toContainText("$0.0001");
}

test("输入框：上面输入区、下面工具行，同一块底上没有分隔线，控件和输入区之间有留白", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    // 关掉入场动画再量：动画中途的 transform 会让位置差零点几像素。
    await page.emulateMedia({ reducedMotion: "reduce" });
    const body = await page.locator(".composer-body").boundingBox();
    const tools = page.locator(".composer-tools");
    const toolsBox = await tools.boundingBox();
    expect(body && toolsBox && toolsBox.y - (body.y + body.height)).toBeGreaterThanOrEqual(0);
    expect(await inPage<string>(page, ".composer-tools", "(el) => getComputedStyle(el).borderTopWidth")).toBe("0px");
    // 模型胶囊和输入区之间至少 4px（3.0 起工具行 36 高、胶囊 28 高，上下各 4）。
    const chip = await page.getByTestId("model-chip").boundingBox();
    expect(chip && body && chip.y - (body.y + body.height)).toBeGreaterThanOrEqual(4);
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
    // 侧栏里这一组叫"默认文件夹"，不露出 chats 这个目录名。
    await expect(page.getByTestId("sidebar")).toContainText(/默认文件夹|Default folder/);
    await expect(page.getByTestId("sidebar")).not.toContainText("chats");
    await expect(page.getByTestId("sidebar-new-task")).not.toHaveAttribute("aria-current", "page");

    // 之后 Ctrl N 还是默认文件夹（不沿用刚才的项目也一样是它）；项目标签直接写它的路径。
    await page.keyboard.press("Control+n");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "no-project");
    await expect(page.getByTestId("empty-project")).toHaveText(chats);
  } finally {
    await launched.close();
  }
});

test("空状态、对话里的用量、模型选择对话框；截图", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    // 新任务草稿：还没有会话，发送键左边是上下文圆环（0%，只有圆、没有文字，窗口取默认模型的）和 $0.00。
    // 项目不是 git 仓库：输入框下面只有项目按钮，没有工作树开关。
    const draft = page.getByTestId("draft-composer");
    await expect(draft.getByTestId("context-meter")).toHaveAttribute("aria-label", /0%/);
    await expect(draft.getByTestId("context-meter")).toHaveText("");
    await expect(draft.getByTestId("usage-cost")).toHaveText("$0.00");
    await expect(page.getByTestId("model-chip").locator("svg:not(.chip-caret)")).toHaveCount(0);
    await expect(draft.getByTestId("empty-project")).toBeVisible();
    await expect(page.getByTestId("worktree-chip")).toHaveCount(0);
    await sendFirst(page, "用一句中文回答：2+2 等于几？不要调用任何工具。");

    // 工具行里不再有本会话 token 图标：模型胶囊之后，发送键左边依次是上下文圆环
    // （fixture 上下文不到 1%，没有文字）和费用 $0.00006513，每日用量和额度在费用的对话框里。
    const tools = page.locator(".composer-tools");
    await expect(page.getByTestId("usage-tokens")).toHaveCount(0);
    const contextMeter = tools.getByTestId("context-meter");
    await expect(contextMeter).toHaveAttribute("aria-label", /0\.\d/);
    await expect(contextMeter).toHaveText("");
    await expect(page.locator(".composer-stack > [data-testid=usage-meter]")).toHaveCount(0);
    const cost = tools.getByTestId("usage-cost");
    await expect(cost).toContainText("$0.0001");
    // 四个框一起量：发送后输入框还在从草稿换成任务的布局，分开量会量到不同时刻的位置。
    const [chipBox, contextBox, costBox, sendBox] = await Promise.all(
      [page.getByTestId("model-chip"), contextMeter, cost, page.getByTestId("send-button")].map((locator) =>
        locator.boundingBox(),
      ),
    );
    // 同一行，从左到右：模型胶囊、圆环、费用、发送键；圆环和模型胶囊垂直中线对齐。
    expect(contextBox && chipBox && contextBox.x).toBeGreaterThanOrEqual((chipBox?.x ?? 0) + (chipBox?.width ?? 0));
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
    // 下面是"会话用量"按钮（不再有"压缩上下文"）。Esc 关闭后焦点回到圆环。
    await page.getByTestId("context-meter").click();
    const breakdown = page.getByTestId("context-breakdown");
    await expect(breakdown).toBeVisible();
    for (const part of ["system", "tools", "messages", "free"])
      await expect(breakdown.locator(`[data-testid="context-row"][data-part="${part}"]`)).toHaveCount(1);
    // 构成下面不再有说明小字。
    await expect(breakdown.locator(".ctx-note")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /压缩上下文|Compact context/ })).toHaveCount(0);
    await shoot(page, "context");

    // 点"会话用量"：浮层向左加宽，按模型的明细出现在构成左边，构成的位置不动；再点收回。
    const breakdownBefore = await breakdown.boundingBox();
    const usageToggle = page.getByTestId("session-usage-toggle");
    await expect(usageToggle).toHaveAttribute("aria-expanded", "false");
    await usageToggle.click();
    const sessionUsage = page.getByTestId("session-usage");
    await expect(sessionUsage.getByTestId("model-breakdown")).toBeVisible();
    await expect(usageToggle).toHaveAttribute("aria-expanded", "true");
    const [usageBox, breakdownAfter] = await Promise.all([sessionUsage.boundingBox(), breakdown.boundingBox()]);
    expect((usageBox?.x ?? 0) + (usageBox?.width ?? 0)).toBeLessThanOrEqual(breakdownAfter?.x ?? 0);
    expect(Math.abs((breakdownAfter?.x ?? 0) - (breakdownBefore?.x ?? 0))).toBeLessThanOrEqual(2);
    await shoot(page, "model-usage");
    await usageToggle.click();
    await expect(sessionUsage).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(breakdown).toHaveCount(0);
    await expect(page.getByTestId("context-meter")).toBeFocused();
    // 点费用：居中的对话框（不是贴着按钮的浮层），顶上是"订阅额度 / 每日用量"切换框，默认订阅额度，←/→ 切页，
    // 切页时对话框大小不变；没有"去设置看全年"；Esc 关闭后焦点回到费用。
    await cost.click();
    const overview = page.getByRole("dialog", { name: /用量与额度|Usage and quota/ });
    await expect(overview).toBeVisible();
    await expect(overview.getByTestId("usage-tab-quota")).toHaveAttribute("aria-selected", "true");
    await expect(overview.getByTestId("quota-section")).toBeVisible();
    await expect(overview.getByTestId("heatmap-section")).toBeHidden();
    await overview.getByTestId("usage-tab-quota").focus();
    await page.keyboard.press("ArrowRight");
    await expect(overview.getByTestId("usage-tab-daily")).toBeFocused();
    await expect(overview.getByTestId("heatmap-section")).toBeVisible();
    // 热力图在对话框里居中。
    const [heatBox, sectionBox] = await Promise.all([
      overview.getByTestId("heatmap-section").locator(".uq-heat").boundingBox(),
      overview.getByTestId("heatmap-section").boundingBox(),
    ]);
    expect(
      Math.abs((heatBox?.x ?? 0) + (heatBox?.width ?? 0) / 2 - ((sectionBox?.x ?? 0) + (sectionBox?.width ?? 0) / 2)),
    ).toBeLessThanOrEqual(2);
    await expect(overview.getByTestId("quota-section")).toBeHidden();
    const dailyBox = await overview.boundingBox();
    await page.keyboard.press("ArrowLeft");
    await expect(overview.getByTestId("quota-section")).toBeVisible();
    expect(await overview.boundingBox()).toEqual(dailyBox);
    await page.keyboard.press("ArrowRight");
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
    // 一张表：没有 provider 组头，行直接可见；底部是正在生效的模型的参数（照终端版 omp）。
    await expect(page.getByTestId("model-option").first()).toBeVisible();
    const details = page.getByTestId("model-details");
    await expect(details).toContainText("1M");
    await expect(page.getByTestId("model-speed").first()).not.toHaveText("…");
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
    // @ 开头列角色（每个角色一行，带绑定的模型），清空后回到模型表。
    await page.getByTestId("model-search").fill("@");
    await expect(page.getByTestId("model-role-option").first()).toBeVisible();
    await expect(page.getByTestId("model-option")).toHaveCount(0);
    await page.getByTestId("model-search").fill("");
    await expect(page.getByTestId("model-option").first()).toBeVisible();
    await page.getByTestId("model-search").focus();
    await shoot(page, "model-picker");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(chip).toBeFocused();

    // 回到空状态：Ctrl N 一律是默认文件夹，不沿用刚才任务的项目；只有标志和输入框，没有最近的任务和历史会话。
    await page.keyboard.press("Control+n");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "no-project");
    await expect(page.getByTestId("empty-task")).toHaveCount(0);
    await expect(page.getByTestId("empty-session")).toHaveCount(0);
    await expect(page.getByTestId("empty-project")).toHaveText(/[\\/]chats$/);
    // 文件夹头部常驻的 ＋：在这个文件夹里开新任务，工具行的项目标签换成项目的路径。
    await expect(page.getByTestId("sidebar-project-new").first()).toBeVisible();
    await page.getByTestId("sidebar-project-new").first().click();
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    await expect(page.getByTestId("empty-project")).toHaveText(/[\\/]项目 目录$/);
    // 文件夹标签（纯文字，不是胶囊）在工具行里，紧跟审批胶囊，垂直居中在同一行。
    const draftTools = page.getByTestId("draft-composer").locator(".composer-tools");
    await expect(draftTools.getByTestId("empty-project")).toBeVisible();
    const [approvalBox, projectBox] = await Promise.all([
      draftTools.getByTestId("approval-chip").boundingBox(),
      draftTools.getByTestId("empty-project").boundingBox(),
    ]);
    expect(approvalBox && projectBox && approvalBox.x + approvalBox.width <= projectBox.x).toBe(true);
    const midY = (box: { y: number; height: number }) => box.y + box.height / 2;
    expect(approvalBox && projectBox && Math.abs(midY(approvalBox) - midY(projectBox)) <= 2).toBe(true);
    // 不画成胶囊：没有底色。
    await expect(draftTools.getByTestId("empty-project")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.locator("[data-composer-input]").focus();
    await shoot(page, "empty");
  } finally {
    await cleanup();
  }
});

test("侧栏：竖排 搜索 / [新任务] / [打开文件夹]；任务和历史会话合在一个列表里（文件夹 / 时间）；搜索过滤两者", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await sendFirst(page, "用一句中文回答：2+2 等于几？不要调用任何工具。");
    const sidebar = page.getByTestId("sidebar");
    const search = page.getByTestId("sidebar-search");
    const newTask = page.getByTestId("sidebar-new-task");
    const addProject = page.getByTestId("sidebar-open-folder");
    const [n, s, a, list] = await Promise.all([
      newTask.boundingBox(),
      search.boundingBox(),
      addProject.boundingBox(),
      sidebar.locator(".sb-list-host").boundingBox(),
    ]);
    // 三行竖排：搜索 / 新任务 / 打开文件夹，都在项目列表上方。
    expect(s && n && s.y + s.height <= n.y).toBe(true);
    expect(n && a && n.y + n.height <= a.y).toBe(true);
    expect(a && list && a.y + a.height <= list.y).toBe(true);

    // 一个列表：项目文件夹（有刚发的任务，选中所以展开）和只在历史里出现的文件夹都在"历史会话"这一个区块里，没有单独的项目块。
    const history = page.getByTestId("sidebar-history");
    await expect(page.getByTestId("task-row")).toHaveCount(1);
    await expect(history.getByTestId("task-row")).toHaveCount(1);
    await expect(sidebar.locator(".sb-group")).toHaveCount(1);
    await expect(page.getByTestId("sidebar-history-by-folder")).toHaveAttribute("aria-pressed", "true");
    const folders = history.getByTestId("sidebar-folder");
    await expect(folders).toHaveCount(2);
    // 不搜索也列出历史会话（launchApp 造的 6 条假会话，cwd 都是"omp studio 假项目"）；刚发的那条已挂在任务上，不在这里。
    // 这个文件夹没有选中/在跑的任务，折叠着：名字 + 条数。
    const fakeFolder = folders.filter({ hasText: "omp studio 假项目" });
    await expect(fakeFolder).toHaveCount(1);
    await expect(fakeFolder).toContainText("6");
    await expect(history.getByTestId("sidebar-session")).toHaveCount(0);
    // 点开文件夹：先显示 5 条（新到旧）+ 显示更多。
    await fakeFolder.locator(".sb-group-toggle").click();
    await expect(history.getByTestId("sidebar-session")).toHaveCount(5);
    await expect(history.getByTestId("sidebar-session").first()).toContainText("整理日志格式并补上单元测试");
    await history.getByTestId("sidebar-history-more").click();
    await expect(history.getByTestId("sidebar-session")).toHaveCount(6);
    await shoot(page, "sidebar-history-folder");
    // 切到按时间：任务和全部会话平铺一列，新到旧（刚跑完的任务在最上面）。
    await page.getByTestId("sidebar-history-by-time").click();
    await expect(page.getByTestId("sidebar-history-by-time")).toHaveAttribute("aria-pressed", "true");
    await expect(folders).toHaveCount(0);
    await expect(history.getByTestId("task-row")).toHaveCount(1);
    await expect(history.getByTestId("sidebar-session")).toHaveCount(6);
    await expect(history.locator(".sb-row-main").first()).toHaveAttribute("data-nav", /^task:/);
    await expect(history.getByTestId("sidebar-session").first()).toContainText("整理日志格式并补上单元测试");
    await shoot(page, "sidebar-history-time");
    await search.fill("zzz-no-match");
    await expect(page.getByTestId("task-row")).toHaveCount(0);
    await expect(sidebar).toContainText(/没有匹配|No matching/);
    // 历史会话：launchApp 造的假会话里有 "Fix the flaky login test on CI"。
    await search.fill("login");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(1);
    await expect(page.getByTestId("sidebar-session").first()).toContainText("Fix the flaky login test on CI");
    await shoot(page, "sidebar-search");
    // Esc 清空搜索，任务和全部历史会话恢复。
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.getByTestId("task-row")).toHaveCount(1);
    await expect(page.getByTestId("sidebar-session")).toHaveCount(6);
    // 设置图标不再是太阳：齿轮轮廓是一条闭合路径加中心圆。
    await expect(sidebar.locator(".sb-settings svg path")).toHaveCount(1);
    await expect(sidebar.locator(".sb-settings svg circle")).toHaveCount(1);
  } finally {
    await cleanup();
  }
});
