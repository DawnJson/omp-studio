// 阶段 2.6 主界面返工的端到端：空状态（最近任务、输入框贴底）、输入框两层布局、模型选择对话框、用量行、侧栏搜索。
// 用 fixtures/tsp/slash-status 回放（假 omp，不调真实模型）。
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, testOmp, type LaunchedApp } from "./launch.ts";

const fixture = "slash-status";

async function start(): Promise<{ launched: LaunchedApp; cleanup(): Promise<void> }> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 主界面 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp(fixture) });
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

/** 在草稿输入框里发出第一条消息，等任务的输入框和 omp 的过程区出现（上下文占用来自 omp 输入框卡片上的 meter）。 */
async function sendFirst(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("composer-input");
  await input.fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("composer-stack").getByTestId("context-meter")).toHaveAttribute("aria-label", /0\.\d/);
}

test("界面字体是打包的 Geist / Geist Mono：第一帧之前两个字体文件都读进来了", async () => {
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp(fixture) });
  try {
    const { page } = launched;
    await expect(page.getByTestId("empty-state")).toBeVisible();
    // CSP 拦了 font-src、打包后路径不对、或 --font-* 不再以它们开头时，浏览器静默落回系统字体，界面照样能用，只能这样查出来。
    // 其它 @font-face（如 KaTeX）按需才读，不在这里比。
    const faces = await page.evaluate(() =>
      [
        ...(globalThis as unknown as { document: { fonts: Iterable<{ family: string; status: string }> } }).document
          .fonts,
      ]
        .map((face) => `${face.family.replaceAll('"', "")}:${face.status}`)
        .filter((face) => face.startsWith("Geist"))
        .sort(),
    );
    expect(faces).toEqual(["Geist Mono:loaded", "Geist:loaded"]);
  } finally {
    await launched.close();
  }
});

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

// 2026-10-30 仓库所有者：窗口放大时对话列不能只是两边空白变宽。对话列和输入框同宽同轴，约占主区面板 80%，最窄 840、最宽 1200。
test("窗口放大时对话列和输入框一起变宽：约占主区 80%，最窄 840、最宽 1200", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await sendFirst(page, "用一句中文回答：2+2 等于几？不要调用任何工具。");
    const column = page.locator('[data-testid="tsp-view"] .tsp-column.tsp-main');
    const measure = async () => {
      const [panel, col, stack] = await Promise.all([
        page.getByTestId("main-panel").evaluate((el) => (el as unknown as { clientWidth: number }).clientWidth),
        column.boundingBox(),
        page.getByTestId("composer-stack").boundingBox(),
      ]);
      if (col === null || stack === null) throw new Error("对话列或输入框不可见");
      // 同宽同轴：输入框和对话列左右边一致。
      expect(Math.abs(stack.x - col.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(stack.width - col.width)).toBeLessThanOrEqual(1);
      return { panel, width: col.width };
    };
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect.poll(async () => (await measure()).width).toBeCloseTo(840, 0);
    await page.setViewportSize({ width: 1700, height: 800 });
    await expect
      .poll(async () => {
        const { panel, width } = await measure();
        return width - panel * 0.8;
      })
      .toBeCloseTo(0, 0);
    expect((await measure()).width).toBeGreaterThan(1000);
    await page.setViewportSize({ width: 2400, height: 800 });
    await expect.poll(async () => (await measure()).width).toBeCloseTo(1200, 0);
  } finally {
    await cleanup();
  }
});

test("没有项目时直接发送：在 chats 目录里建项目和任务，侧栏出现这个项目", async () => {
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp(fixture) });
  try {
    const { page, userDataDir } = launched;
    const chats = path.join(userDataDir, "chats");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "no-project");
    // 草稿页 = 新任务：侧栏按钮标为当前。
    await expect(page.getByTestId("sidebar-new-task")).toHaveAttribute("aria-current", "page");
    await page.locator("[data-composer-input]").focus();

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

test("空状态、对话里的用量", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    // 关掉动效：浮层的弹出动画里 boundingBox 在缩放，量到的尺寸不是最终尺寸。
    await page.emulateMedia({ reducedMotion: "reduce" });
    // 新任务草稿：还没有会话，发送键左边是上下文圆环和 $0.00。STUDIO_TEST_OMP 的假 omp 不回答模型目录，
    // 草稿拿不到默认模型的窗口，所以这里是不能点的占位圆环（有数据时的 0% 圆环见 model-chip.e2e.ts）。
    // 项目不是 git 仓库：输入框下面只有项目标签，顶栏没有草稿的分支胶囊。
    const draft = page.getByTestId("draft-composer");
    await expect(draft.getByTestId("context-meter-pending")).toHaveCount(1);
    await expect(draft.getByTestId("context-meter")).toHaveCount(0);
    await expect(draft.getByTestId("usage-cost")).toHaveText("$0.00");
    await expect(page.getByTestId("model-chip").locator("svg")).toHaveCount(0);
    await expect(draft.getByTestId("empty-project")).toBeVisible();
    await expect(page.getByTestId("draft-git-menu")).toHaveCount(0);
    await sendFirst(page, "用一句中文回答：2+2 等于几？不要调用任何工具。");

    // 工具行里不再有本会话 token 图标：模型胶囊之后，发送 / 停止键左边依次是上下文圆环
    // （fixture 上下文不到 1%，没有文字）和费用 $0.00，每日用量和额度在费用的对话框里。
    const tools = page.locator(".composer-tools");
    await expect(page.getByTestId("usage-tokens")).toHaveCount(0);
    const contextMeter = tools.getByTestId("context-meter");
    await expect(contextMeter).toHaveAttribute("aria-label", /0\.\d/);
    await expect(contextMeter).toHaveText("");
    await expect(page.locator(".composer-stack > [data-testid=usage-meter]")).toHaveCount(0);
    const cost = tools.getByTestId("usage-cost");
    await expect(cost).toContainText("$0.00");
    // 四个框一起量：发送后输入框还在从草稿换成任务的布局，分开量会量到不同时刻的位置。
    const [chipBox, contextBox, costBox, sendBox] = await Promise.all(
      [page.getByTestId("model-chip"), contextMeter, cost, tools.locator(".send")].map((locator) =>
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

    // 上下文构成：omp 的 /context 怎么读见 context-report.e2e.ts（slash-status 回放里没有报告），这里换掉主进程的读取，
    // 只看浮层排版：每类一行，下面没有说明小字。Esc 关闭后焦点回到圆环。
    await launched.app.evaluate(({ ipcMain }) => {
      const rows = [
        ["systemPrompt", "System prompt", 2958],
        ["systemTools", "System tools", 4543],
        ["systemContext", "System context", 115],
        ["skills", "Skills", 549],
        ["messages", "Messages", 1200],
        ["free", "Free space", 160635],
        ["buffer", "Autocompact buffer", 30000],
      ] as const;
      ipcMain.removeHandler("studio:readTspContext");
      ipcMain.handle("studio:readTspContext", () => ({
        rows: rows.map(([key, label, tokens]) => ({ key, label, tokens })),
        used: 9365,
        window: 200000,
      }));
    });
    await page.getByTestId("context-meter").click();
    const breakdown = page.getByTestId("context-breakdown");
    await expect(breakdown).toBeVisible();
    await expect(breakdown.getByTestId("context-row")).toHaveCount(7);
    await expect(breakdown.locator(".ctx-note")).toHaveCount(0);
    const single = await breakdown.boundingBox();
    await expect(page.getByRole("button", { name: /压缩 context|Compact context/i })).toHaveCount(0);

    // 这个任务的会话文件里还没有回复（假 omp 不写会话文件）：浮层是单栏，没有空的左栏。
    await expect(page.getByTestId("session-usage")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(breakdown).toHaveCount(0);
    await expect(page.getByTestId("context-meter")).toBeFocused();

    // 有回复时（换掉主进程读会话用量的处理，给三个模型，用量栏比构成高）：一打开左边就是会话用量，不用再点按钮；
    // 右边的构成和单栏时在同一位置、同样宽（文字不重新折行）。
    await launched.app.evaluate(({ ipcMain }) => {
      const row = (modelId: string, total: number) => ({
        provider: "deepseek",
        modelId,
        input: total / 2,
        output: total / 4,
        cacheRead: total / 4,
        cacheWrite: 0,
        total,
        cost: total / 1e6,
        requests: 3,
      });
      ipcMain.removeHandler("studio:getSessionModelUsage");
      ipcMain.handle("studio:getSessionModelUsage", () => ({
        models: [row("deepseek-v4-flash", 120_000), row("deepseek-v4-pro", 80_000), row("deepseek-v4-lite", 9_000)],
        compactions: 0,
        whole: null,
      }));
    });
    await page.getByTestId("context-meter").click();
    await expect(page.getByTestId("session-usage")).toBeVisible();
    await expect(page.getByTestId("model-usage")).toHaveCount(3);
    expect(await breakdown.boundingBox()).toEqual(single);
    await page.keyboard.press("Escape");
    await expect(breakdown).toHaveCount(0);
    // 点费用：居中的对话框（不是贴着按钮的浮层），标题"用量与额度"，没有页签：订阅额度和每日用量热力图在同一页，
    // 对话框大小固定；没有"去设置看全年"；Esc 关闭后焦点回到费用。
    await cost.click();
    const overview = page.getByRole("dialog", { name: /用量与额度|Usage and quota/ });
    await expect(overview).toBeVisible();
    await expect(overview.getByRole("tablist")).toHaveCount(0);
    await expect(overview.getByRole("heading", { name: /用量与额度|Usage and quota/ })).toBeVisible();
    await expect(overview.getByTestId("quota-section")).toBeVisible();
    await expect(overview.getByTestId("heatmap-section")).toBeVisible();
    // 对话框高度跟内容走（没有固定高度）：底部不留空，不超出窗口。
    // 热力图占满对话框内容宽度。
    const [heatBox, sectionBox] = await Promise.all([
      overview.getByTestId("heatmap-section").locator(".uq-heat").boundingBox(),
      overview.getByTestId("heatmap-section").boundingBox(),
    ]);
    expect((heatBox?.width ?? 0) / (sectionBox?.width ?? 1)).toBeGreaterThan(0.98);
    const gridBox = await overview.getByTestId("heatmap-section").locator(".usage-grid").boundingBox();
    expect((gridBox?.x ?? 0) + (gridBox?.width ?? 0)).toBeGreaterThan(
      (sectionBox?.x ?? 0) + (sectionBox?.width ?? 0) - 24,
    );
    // 月份标签不超出格子区右边：12 月 1 日落在最后一周（2026-12-01 是周二），"12月"写在最后一列，文字要在右边缘内结束。
    await launched.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("studio:getUsageHeatmap");
      ipcMain.handle("studio:getUsageHeatmap", () => ({
        from: "2025-12-02",
        to: "2026-12-01",
        days: [{ date: "2026-11-30", tokens: 1000, costUsd: 1, requests: 2 }],
        hasDatabase: true,
      }));
    });
    await overview.getByTestId("usage-refresh").click();
    const scroller = overview.getByTestId("heatmap-section").locator(".usage-scroll");
    await expect(scroller.locator(".uq-month").last()).toHaveText(/12|Dec/);
    const overflow = await scroller.evaluate((element) => {
      interface Box {
        right: number;
      }
      interface Node {
        getBoundingClientRect(): Box;
        querySelectorAll(selector: string): ArrayLike<Node & { textContent: string | null }>;
      }
      const g = globalThis as unknown as {
        document: { createRange(): { selectNodeContents(node: unknown): void; getBoundingClientRect(): Box } };
      };
      const root = element as unknown as Node;
      const edge = root.getBoundingClientRect().right;
      return Array.from(root.querySelectorAll(".uq-month"))
        .filter((label) => (label.textContent ?? "") !== "")
        .map((label) => {
          const range = g.document.createRange();
          range.selectNodeContents(label);
          return range.getBoundingClientRect().right - edge;
        })
        .filter((over) => over > 0.5);
    });
    expect(overflow).toEqual([]);
    expect((await overview.boundingBox())?.height ?? 0).toBeLessThan(
      ((await page.evaluate("innerHeight")) as number) - 96 + 1,
    );
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
    // 内容不超出对话框边框：汇总条、热力图的右边都在对话框里，正文不出横向滚动。
    for (const testId of ["heatmap-section", "quota-section"]) {
      const box = await overview.getByTestId(testId).boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0));
    }
    const bodyOverflows = await overview.locator(".ui-dialog-body").evaluate((element) => {
      const body = element as unknown as { scrollWidth: number; clientWidth: number };
      return body.scrollWidth > body.clientWidth;
    });
    expect(bodyOverflows).toBe(false);
    await page.keyboard.press("Escape");
    await expect(overview).toHaveCount(0);
    await expect(cost).toBeFocused();

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
    // 审批胶囊：图标 + 模式名，来源（项目 / 全局配置）在悬停提示和 aria-label 里；还没读到模式时图标 + 骨架条（aria-busy），
    // 不写"审批…"这种像被截断的字。模型胶囊里项目草稿也显示思考强度（模型支持思考时）。
    const approvalChip = draftTools.getByTestId("approval-chip");
    await expect(approvalChip.locator("svg")).toHaveCount(1);
    if ((await approvalChip.getAttribute("aria-busy")) === "true") {
      await expect(approvalChip).toHaveText("");
      await expect(approvalChip.locator(".ui-skeleton")).toHaveCount(1);
    } else {
      await expect(approvalChip).toHaveText(
        /总是询问|询问并记住|自动写入|全自动|Always ask|Ask and remember|Write|Yolo/,
      );
      await expect(approvalChip).toHaveAttribute("aria-label", /.+ · .+/);
      await expect(approvalChip).toHaveAttribute("title", /.+ · .+/);
    }
    // 和模型胶囊同高（28），不被右栏挤窄：宽度至少放得下图标 + 文字。
    expect(approvalBox && approvalBox.height).toBe(28);
    // 不画成胶囊：没有底色。
    await expect(draftTools.getByTestId("empty-project")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.locator("[data-composer-input]").focus();
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
    await expect(page.getByTestId("sidebar-history-by-folder")).toHaveAttribute("aria-checked", "true");
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
    // 切到按时间：任务和全部会话平铺一列，新到旧（刚跑完的任务在最上面）。
    await page.getByTestId("sidebar-history-by-time").click();
    await expect(page.getByTestId("sidebar-history-by-time")).toHaveAttribute("aria-checked", "true");
    await expect(folders).toHaveCount(0);
    await expect(history.getByTestId("task-row")).toHaveCount(1);
    await expect(history.getByTestId("sidebar-session")).toHaveCount(6);
    await expect(history.locator(".sb-row-main").first()).toHaveAttribute("data-nav", /^task:/);
    await expect(history.getByTestId("sidebar-session").first()).toContainText("整理日志格式并补上单元测试");
    await search.fill("zzz-no-match");
    await expect(page.getByTestId("task-row")).toHaveCount(0);
    await expect(sidebar).toContainText(/无匹配|No matches/);
    // 历史会话：launchApp 造的假会话里有 "Fix the flaky login test on CI"。
    await search.fill("login");
    await expect(page.getByTestId("sidebar-session")).toHaveCount(1);
    await expect(page.getByTestId("sidebar-session").first()).toContainText("Fix the flaky login test on CI");
    // Esc 清空搜索，任务和全部历史会话恢复。
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.getByTestId("task-row")).toHaveCount(1);
    await expect(page.getByTestId("sidebar-session")).toHaveCount(6);
    // 设置图标不再是太阳：齿轮轮廓是一条闭合路径加中心圆。
    await expect(sidebar.locator(".sb-settings svg path")).toHaveCount(1);
    await expect(sidebar.locator(".sb-settings svg circle")).toHaveCount(1);
    // 点设置进设置页：侧栏位置换成设置导航（会话列表不在了），点"返回任务"回到刚才的任务。
    await sidebar.locator(".sb-settings").click();
    await expect(page.getByTestId("settings")).toBeVisible();
    await expect(page.getByTestId("settings-nav")).toBeVisible();
    await expect(page.getByTestId("sidebar")).toHaveCount(0);
    await page.getByTestId("settings-back").click();
    await expect(page.getByTestId("settings")).toHaveCount(0);
    await expect(page.getByTestId("settings-nav")).toHaveCount(0);
    await expect(page.getByTestId("tsp-view")).toBeVisible();
    await expect(sidebar.locator(".sb-settings")).toHaveAttribute("aria-pressed", "false");
  } finally {
    await cleanup();
  }
});
