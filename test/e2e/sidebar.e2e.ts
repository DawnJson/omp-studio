// 侧栏 + 命令面板的端到端：启动构建产物，在主进程里替换 listProjects/listTasks 等 IPC 通道为夹具数据
// （任务运行时由别的切片实现，这里只验证界面和键盘），listSessions 走真实的会话索引，读临时目录里造的会话文件
// （路径含空格和中文）。中文浅色 / 英文深色各跑一遍。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Locale, ProjectId, TaskId, TaskState } from "../../src/shared/ipc.ts";
import { emptySessionToggles } from "../../src/shared/omp-output/toggles.ts";
import { launchApp } from "./launch.ts";

const now = Date.now();
const minute = 60_000;
const projectA = { id: "pa" as ProjectId, path: "E:\\研究 项目\\my app", name: "my app", hidden: false };
const projectB = { id: "pb" as ProjectId, path: "E:\\work\\api server", name: "api server", hidden: false };

/** 页面里量布局用到的最小类型（e2e 的类型检查没有 DOM 类型）。 */
type PageRect = { top: number; left: number; width: number };
type PageScrollBox = {
  style: { maxHeight: string };
  scrollTop: number;
  scrollHeight: number;
  querySelector(selector: string): { getBoundingClientRect(): PageRect } | null;
  getBoundingClientRect(): PageRect;
};

function makeTask(
  id: string,
  projectId: ProjectId,
  title: string,
  ageMinutes: number,
  patch: Partial<TaskState> = {},
): TaskState {
  return {
    id: id as TaskId,
    projectId,
    title,
    status: "idle",
    unread: false,
    lastTurn: null,
    error: null,
    createdAt: now - ageMinutes * minute,
    updatedAt: now - ageMinutes * minute,
    model: null,
    thinkingLevel: null,
    thinkingLevels: [],
    contextUsage: null,
    sessionUsage: null,
    dialogs: [],
    todoPhases: [],
    cwd: "",
    worktreeBranch: null,
    runStartedAt: null,
    fastMode: { enabled: false, active: false },
    slowMode: { supported: false, enabled: false, scope: null },
    goal: null,
    sessionToggles: emptySessionToggles(),
    workspaceDirs: [],
    keepAlive: false,
    fallbackModel: null,
    credentialPins: {},
    restartable: false,
    loaderText: null,
    prNumber: null,
    contextCompaction: null,
    composerMode: null,
    extStatuses: [],
    ...patch,
  };
}

const tasks: TaskState[] = [
  makeTask("t1", projectA.id, "修复登录页的 bug", 3, { status: "needs_you" }),
  makeTask("t2", projectA.id, "重构数据层", 8, {
    status: "running",
    runStartedAt: now - 5 * minute,
  }),
  makeTask("t3", projectA.id, "整理日志格式", 40, { unread: true, lastTurn: { status: "completed", endedAt: now } }),
  makeTask("t4", projectA.id, "升级依赖", 130, { status: "error", error: { kind: "exited", message: "omp 退出了" } }),
  makeTask("t5", projectA.id, "写发布说明", 60 * 26),
  makeTask("t6", projectA.id, "清理旧分支", 60 * 50, { lastTurn: { status: "aborted", endedAt: now } }),
  makeTask("t7", projectA.id, "第七个任务", 60 * 90),
  makeTask("t8", projectB.id, "Deploy pipeline", 15, { status: "needs_you" }),
  makeTask("t9", projectB.id, "Write API docs", 300),
];

const headerLine = (id: string, cwd: string) =>
  `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-10-18T00:00:00.000Z", cwd })}\n`;
const userLine = (text: string) =>
  `${JSON.stringify({ type: "message", id: "a1", parentId: null, message: { role: "user", content: [{ type: "text", text }] } })}\n`;
const assistantLine = (stopReason: string) =>
  `${JSON.stringify({ type: "message", id: "b1", parentId: "a1", message: { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason } })}\n`;

async function makeAgentDir(): Promise<string> {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp 会话 agent-"));
  const bucket = path.join(agentDir, "sessions", "--E--研究 项目-my app--");
  await mkdir(bucket, { recursive: true });
  await writeFile(
    path.join(bucket, "a_terminal.jsonl"),
    headerLine("sess-terminal", projectA.path) + userLine("在终端里排查内存泄漏") + assistantLine("stop"),
    "utf8",
  );
  await writeFile(path.join(bucket, "b_broken.jsonl"), "{损坏的会话文件\n", "utf8");
  const notesBucket = path.join(agentDir, "sessions", "--E--其他 目录-notes--");
  await mkdir(notesBucket, { recursive: true });
  await writeFile(
    path.join(notesBucket, "c_notes.jsonl"),
    headerLine("sess-notes", "E:\\其他 目录\\notes") + userLine("\ue5fa 写笔记"),
    "utf8",
  );
  return agentDir;
}

/** 在主进程里替换 IPC 通道；调用记录存在 globalThis.__calls，供断言读取。 */
async function stubMain(app: Awaited<ReturnType<typeof launchApp>>["app"], locale: Locale): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, data) => {
      const calls: [string, unknown[]][] = [];
      Reflect.set(globalThis, "__calls", calls);
      const stub = (name: string, result: (...args: unknown[]) => unknown) => {
        ipcMain.removeHandler(`studio:${name}`);
        ipcMain.handle(`studio:${name}`, (_event, ...args: unknown[]) => {
          calls.push([name, args]);
          return result(...args);
        });
      };
      stub("getAppInfo", () => ({
        version: "0.0.0",
        platform: "win32",
        locale: data.locale,
        isPackaged: false,
        runtime: { electron: "0", chromium: "0", node: "0" },
      }));
      stub("listProjects", () => data.projects);
      stub("listTasks", () => data.tasks);
      stub("openTask", () => undefined);
      stub("renameTask", () => undefined);
      stub("archiveTask", () => undefined);
      // 从列表移除 = 藏起来：之后 listProjects 带 hidden。
      stub("removeProject", (id) => {
        for (const project of data.projects) if (project.id === id) project.hidden = true;
      });
      stub("createTask", () => data.tasks[0]);
      stub("listSlashCommands", () => data.slash);
      stub("getShellState", () => ({ sidebarWidth: 264, sidebarCollapsed: false, historyOrder: "folder" }));
      stub("ensureSessionProject", () => ({ id: "pn", path: "E:\\其他 目录\\notes", name: "notes", hidden: false }));
      stub("setShellState", () => undefined);
    },
    {
      locale,
      projects: [projectA, projectB],
      tasks,
      slash: [
        { name: "compact", source: "builtin", description: "Compact the context" },
        { name: "model", source: "builtin", input: { hint: "<model>" } },
      ],
    },
  );
}

async function mainCalls(app: Awaited<ReturnType<typeof launchApp>>["app"], name: string): Promise<unknown[][]> {
  return app.evaluate((_electron, wanted) => {
    const calls: [string, unknown[]][] = Reflect.get(globalThis, "__calls") ?? [];
    return calls.filter(([callName]) => callName === wanted).map(([, args]) => args);
  }, name);
}

const text = {
  "zh-CN": {
    newTask: "新任务",
    waitingMany: "2 个任务在等你",
    settings: "设置",
    archived: "已归档",
    undo: "撤销",
    sessions: "会话",
    placeholder: "搜索任务或命令…",
  },
  en: {
    newTask: "New task",
    waitingMany: "2 tasks waiting for you",
    settings: "Settings",
    archived: "Archived",
    undo: "Undo",
    sessions: "Sessions",
    placeholder: "Search tasks or commands…",
  },
} as const;

for (const [locale, colorScheme] of [
  ["zh-CN", "light"],
  ["en", "dark"],
] as const) {
  test(`侧栏和命令面板：${locale} / ${colorScheme}`, async () => {
    const agentDir = await makeAgentDir();
    const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
    const { app, page } = launched;
    const words = text[locale];
    try {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await stubMain(app, locale);
      await page.reload();

      const sidebar = page.getByTestId("sidebar");
      await expect(sidebar.getByRole("button", { name: new RegExp(words.newTask) }).first()).toBeVisible();

      // 一个列表：项目和只在历史里出现的 cwd 合并成文件夹，没有单独的项目块；
      // my app 里有选中/在跑/等你确认的任务所以默认展开：终端会话和任务混排，默认 5 行，其余在"显示更多"后面。
      const history = sidebar.getByTestId("sidebar-history");
      const myApp = sidebar.getByRole("region", { name: "my app" });
      await expect(history.getByTestId("sidebar-folder")).toHaveCount(3);
      await expect(sidebar.getByTestId("sidebar-folder")).toHaveCount(3);
      await expect(sidebar.getByRole("region", { name: "api server" })).toBeVisible();
      await expect(myApp.getByTestId("sidebar-session")).toContainText("在终端里排查内存泄漏");
      // 历史会话的状态图标只画失败 / 中断：最后一轮正常答完的不画，但槽位留着（标题对齐）。
      const session = myApp.getByTestId("sidebar-session").filter({ hasText: "在终端里排查内存泄漏" });
      await expect(session.locator(".sb-dot")).toBeVisible();
      await expect(session.locator(".sb-dot-mark")).toHaveCount(0);
      await expect(myApp.getByTestId("task-row")).toHaveCount(4);
      await expect(sidebar.getByTestId("waiting-strip")).toContainText(words.waitingMany);
      await myApp.getByTestId("sidebar-history-more").click();
      await expect(myApp.getByTestId("task-row")).toHaveCount(7);

      // 只在历史里出现的文件夹：默认折叠、有 +、没有项目菜单；图标字形不进标题；+ 先把它加成项目再开草稿。
      const notes = sidebar.getByRole("region", { name: "notes" });
      await expect(notes.getByTestId("sidebar-session")).toHaveCount(0);
      // 折叠：+ 左边是行数；纯历史文件夹没有 ⋯。展开的 studio 项目：同一格常驻 ⋯（不用悬停），行数隐去。
      await expect(notes.locator(".sb-group-count")).toBeVisible();
      await expect(notes.locator(".sb-group-count")).toContainText("1");
      await expect(notes.locator(".sb-group-more")).toHaveCount(0);
      await expect(myApp.locator(".sb-group-more")).toBeVisible();
      await expect(myApp.locator(".sb-group-count")).toBeHidden();
      await notes.locator(".sb-group-toggle").click();
      await expect(notes.getByTestId("sidebar-session")).toHaveText(/^写笔记/);
      await expect(notes.getByTestId("sidebar-session")).not.toContainText("\ue5fa");
      await expect(notes.getByTestId("sidebar-session").locator("svg")).toHaveCount(0);
      await notes.getByTestId("sidebar-project-new").click();
      await expect.poll(async () => (await mainCalls(app, "ensureSessionProject"))[0]?.[0]).toBe("sess-notes");
      await expect(myApp.locator(".sb-group-more")).toHaveCount(1);

      // 搜索同时过滤任务和会话，两种排列都一样。
      const search = sidebar.getByTestId("sidebar-search");
      await search.fill("数据");
      await expect(sidebar.getByTestId("task-row")).toHaveCount(1);
      await expect(sidebar.getByTestId("sidebar-session")).toHaveCount(0);
      await search.fill("内存");
      await expect(sidebar.getByTestId("task-row")).toHaveCount(0);
      await expect(myApp.getByTestId("sidebar-session")).toHaveCount(1);
      await search.fill("");

      // 按时间：任务和会话平铺成一列，没有文件夹；先显示 40 行，这里一共 11 行，全部露出、没有"显示更多"。
      await sidebar.getByTestId("sidebar-history-by-time").click();
      await expect(sidebar.getByTestId("sidebar-folder")).toHaveCount(0);
      await expect(sidebar.getByTestId("sidebar-session")).toHaveCount(2);
      await expect(history.locator(".sb-row-main")).toHaveCount(11);
      await expect(history.getByTestId("sidebar-history-more")).toHaveCount(0);
      await sidebar.getByTestId("sidebar-history-by-folder").click();
      await expect(sidebar.getByTestId("sidebar-folder")).toHaveCount(3);

      // 排列切换两段等宽，短的那段（"时间"）文字也在格子正中。
      const timeTextOffset = await sidebar.getByTestId("sidebar-history-by-time").evaluate((button) => {
        const page = globalThis as unknown as {
          document: { createRange(): { selectNodeContents(node: unknown): void; getBoundingClientRect(): PageRect } };
        };
        const range = page.document.createRange();
        range.selectNodeContents(button);
        const textBox = range.getBoundingClientRect();
        // e2e 没有 DOM 类型：按钮是页面里的元素，只用它的外框。
        const element = button as unknown as { getBoundingClientRect(): PageRect };
        const box = element.getBoundingClientRect();
        return textBox.left + textBox.width / 2 - (box.left + box.width / 2);
      });
      expect(Math.abs(timeTextOffset)).toBeLessThan(1);
      // 标题行在滚动时完全不动：没滚、刚滚一点、滚到底，上沿都贴着滚动区上沿（不先跟着走几像素再钉住，上面也不留透出行的缝）。
      // 夹具行数撑不满默认窗口，临时把列表压矮让它能滚。
      const list = sidebar.locator(".sb-list");
      const headOffsets = await list.evaluate((el) => {
        const element = el as unknown as PageScrollBox;
        element.style.maxHeight = "160px";
        const head = element.querySelector(".sb-history-head");
        if (head === null) throw new Error("没有会话标题行");
        const offset = () => head.getBoundingClientRect().top - element.getBoundingClientRect().top;
        const offsets = [offset()];
        element.scrollTop = 2;
        offsets.push(offset());
        element.scrollTop = element.scrollHeight;
        if (element.scrollTop <= 2) throw new Error("侧栏列表没有滚动");
        offsets.push(offset());
        return offsets;
      });
      expect(headOffsets).toEqual([0, 0, 0]);
      await list.evaluate((el) => {
        const element = el as unknown as PageScrollBox;
        element.scrollTop = 0;
        element.style.maxHeight = "";
      });

      // 状态点：形状不同，各有 aria-label；正常结束的任务不画（只有等你 2 + 在跑 1 + 出错 1 个图标）。
      await expect(sidebar.locator(".sb-dot-waiting")).toHaveCount(2);
      await expect(sidebar.locator(".sb-dot-running")).toHaveCount(1);
      await expect(sidebar.locator(".sb-dot-error")).toHaveCount(1);
      await expect(sidebar.locator(".sb-dot-mark")).toHaveCount(4);
      // 键盘：Tab 进入列表后方向键移动，F2 重命名，Enter 提交。
      const firstRow = sidebar.getByTestId("task-row").first().locator(".sb-row-main");
      await firstRow.focus();
      await page.keyboard.press("ArrowDown");
      await expect(sidebar.getByTestId("task-row").nth(1).locator(".sb-row-main")).toBeFocused();
      await page.keyboard.press("F2");
      const rename = sidebar.getByRole("textbox");
      await expect(rename).toBeFocused();
      await rename.fill("已改名的任务");
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await mainCalls(app, "renameTask"))[0]?.[1]).toBe("已改名的任务");

      // 选中：点击任务行，aria-current 标记当前行。
      await sidebar.getByTestId("task-row").first().locator(".sb-row-main").click();
      await expect(sidebar.locator('[aria-current="true"]')).toHaveCount(1);
      // 方向键浏览时焦点留在侧栏；Enter 选中后进输入框。
      const second = sidebar.getByTestId("task-row").nth(1).locator(".sb-row-main");
      await sidebar.getByTestId("task-row").first().locator(".sb-row-main").focus();
      await page.keyboard.press("ArrowDown");
      await expect(second).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-composer-input]")).toBeFocused();

      // ← 折叠文件夹（任务行消失，行数出现），→ 再展开。折叠状态只在本次会话里，不写进外壳状态。
      const toggle = sidebar.getByRole("region", { name: "my app" }).locator(".sb-group-toggle");
      const rows = sidebar.getByRole("region", { name: "my app" }).getByTestId("task-row");
      // 选中任务后输入框的聚焦是同步的（App 里唯一一处），不需要重试。
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(rows).toHaveCount(0);
      await expect(toggle.locator(".sb-group-count")).toContainText("8");
      await expect(toggle.locator(".sb-group-count")).toBeVisible();
      await expect(sidebar.getByRole("region", { name: "my app" }).locator(".sb-group-more")).toBeHidden();
      await toggle.focus();
      await page.keyboard.press("ArrowRight");
      await expect(rows).toHaveCount(7);
      // 运行中的任务行显示已运行时长。
      await expect(sidebar.getByTestId("task-row").filter({ hasText: "重构数据层" })).toContainText(
        locale === "zh-CN" ? "5 分钟" : "5m",
      );

      // 命令面板：Ctrl K 打开；搜历史会话（来自临时目录的真实索引）；Esc 关闭并还原焦点。
      await page.keyboard.press("Control+k");
      const palette = page.getByTestId("command-palette");
      await expect(palette).toBeVisible();
      await expect(palette.getByRole("combobox")).toBeFocused();
      await palette.getByRole("combobox").fill(locale === "zh-CN" ? "内存" : "leak");
      if (locale === "zh-CN") {
        await expect(palette.getByRole("group", { name: words.sessions })).toContainText("在终端里排查内存泄漏");
      }
      await palette.getByRole("combobox").fill("");
      // 斜杠命令用主进程给的真实列表；需要参数的命令也在列表里。
      await palette.getByRole("combobox").fill("/compa");
      await expect(palette.getByRole("option")).toHaveCount(1);
      await expect(palette.getByRole("option").first()).toContainText("/compact");
      await palette.getByRole("combobox").fill("");
      await palette.getByRole("combobox").fill("Deploy");
      await expect(palette.getByRole("option").first()).toContainText("Deploy pipeline");
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);

      // 归档：Delete 立刻从侧栏消失，撤销后回来，没撤销的 8 秒后才真正调用 archiveTask。
      const rowByTitle = (page: Page, title: string) => page.getByTestId("task-row").filter({ hasText: title });
      await page.evaluate(() => {
        const g = globalThis as unknown as {
          __flipCalls: number;
          Element: { prototype: { animate(keyframes: unknown, options?: unknown): unknown } };
        };
        g.__flipCalls = 0;
        const original = g.Element.prototype.animate;
        g.Element.prototype.animate = function (this: unknown, keyframes, options) {
          if (Array.isArray(keyframes) && (keyframes[0] as { transform?: string } | undefined)?.transform !== undefined)
            g.__flipCalls += 1;
          return original.call(this, keyframes, options);
        };
      });
      const flipCalls = (target: Page) =>
        target.evaluate(() => (globalThis as unknown as { __flipCalls: number }).__flipCalls);
      await rowByTitle(page, "整理日志格式").locator(".sb-row-main").focus();
      await page.keyboard.press("Delete");
      await expect(rowByTitle(page, "整理日志格式")).toHaveCount(0);
      await page.getByRole("button", { name: words.undo }).click();
      await expect(rowByTitle(page, "整理日志格式")).toHaveCount(1);
      // 重排补位（FLIP）：减少动效下归档 / 撤销不播位移；开动效后归档，下面的行从旧位置平移回来（Element.animate 带 transform 关键帧）。
      expect(await flipCalls(page)).toBe(0);
      await page.emulateMedia({ colorScheme, reducedMotion: "no-preference" });
      await rowByTitle(page, "升级依赖").locator(".sb-row-main").focus();
      await page.keyboard.press("Delete");
      await expect.poll(() => flipCalls(page)).toBeGreaterThan(0);
      await expect(rowByTitle(page, "升级依赖")).toHaveCount(0);
      expect(await mainCalls(app, "archiveTask")).toEqual([]);
      // toast 补位（FLIP）：再归档一个，叠两条 toast；关掉上面那条，下面那条平移补位。
      await rowByTitle(page, "写发布说明").locator(".sb-row-main").focus();
      await page.keyboard.press("Delete");
      await expect(rowByTitle(page, "写发布说明")).toHaveCount(0);
      const toasts = page.getByTestId("toasts").locator(".toast");
      await expect(toasts).toHaveCount(2);
      const beforeToastFlip = await flipCalls(page);
      await toasts.first().locator("button").last().click();
      await expect(toasts).toHaveCount(1);
      expect(await flipCalls(page)).toBeGreaterThan(beforeToastFlip);
      await expect
        .poll(async () => (await mainCalls(app, "archiveTask")).map((args) => args[0]), { timeout: 15_000 })
        .toEqual(["t4", "t5"]);
    } finally {
      await launched.close();
      await rm(agentDir, { recursive: true, force: true });
    }
  });
}

test("文件夹里等你确认 / 在跑的任务结束后，自动展开的文件夹不自己收起；用户点了才折叠", async () => {
  const agentDir = await makeAgentDir();
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  const { app, page } = launched;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubMain(app, "zh-CN");
    await page.reload();
    // 没有选中任务；api server 因为 Deploy pipeline 在等你确认而默认展开。
    const apiServer = page.getByTestId("sidebar").getByRole("region", { name: "api server" });
    const toggle = apiServer.locator(".sb-group-toggle");
    const deploy = apiServer.getByTestId("task-row").filter({ hasText: "Deploy pipeline" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(deploy.locator(".sb-dot-waiting")).toBeVisible();
    // 主进程推来：这个任务这一轮结束了（不再等你、也不在跑）。文件夹照旧展开，看得到它的图标没了（正常结束不画，槽位留着）。
    const finished = {
      ...tasks.find((task) => task.id === "t8")!,
      status: "idle",
      lastTurn: { status: "completed", endedAt: now },
    };
    await app.evaluate(({ BrowserWindow }, state) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("studio:event:taskState", state);
    }, finished);
    await expect(deploy.locator(".sb-dot-mark")).toHaveCount(0);
    await expect(deploy.locator(".sb-dot")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // 用户自己点了才折叠。
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(deploy).toHaveCount(0);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test('窗口重新获得焦点时重扫历史会话；从列表移除只藏起文件夹（任务不归档），历史会话可归档、在"已归档"里列出、可删除；分叉缩进（issue #8、#9、#10）', async () => {
  const agentDir = await makeAgentDir();
  // 从终端会话分叉出来的会话：parentSession 写父会话文件的路径（omp 从某条消息分叉时就这么写）。
  const bucketA = path.join(agentDir, "sessions", "--E--研究 项目-my app--");
  await writeFile(
    path.join(bucketA, "e_fork.jsonl"),
    `${JSON.stringify({ type: "session", version: 3, id: "sess-fork", timestamp: "2026-10-18T00:00:00.000Z", cwd: projectA.path, parentSession: path.join(bucketA, "a_terminal.jsonl") })}\n` +
      userLine("分叉出来接着排查"),
    "utf8",
  );
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  const { app, page } = launched;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubMain(app, "zh-CN");
    await page.reload();
    const sidebar = page.getByTestId("sidebar");
    const myApp = sidebar.getByRole("region", { name: "my app" });
    const apiServer = sidebar.getByRole("region", { name: "api server" });
    await expect(apiServer.getByTestId("task-row")).toHaveCount(2);
    await expect(apiServer.getByTestId("sidebar-session")).toHaveCount(0);

    // 终端 omp 在这期间建了一个会话：窗口一回到前台就列出来。
    const bucket = path.join(agentDir, "sessions", "--E--work-api server--");
    await mkdir(bucket, { recursive: true });
    await writeFile(
      path.join(bucket, "d_new.jsonl"),
      headerLine("sess-new", projectB.path) + userLine("终端里新开的会话"),
    );
    await page.evaluate(() => globalThis.dispatchEvent(new Event("focus")));
    await expect(apiServer.getByTestId("sidebar-session")).toContainText("终端里新开的会话");

    // 从列表移除：不要求先归档，任务不归档；文件夹连同里面的任务和历史会话一起不见。
    await apiServer.locator(".sb-group-more").click();
    await page.getByRole("menuitem", { name: "从列表移除" }).click();
    await expect(apiServer).toHaveCount(0);
    expect(await mainCalls(app, "removeProject")).toEqual([["pb"]]);
    expect(await mainCalls(app, "archiveTask")).toEqual([]);

    // 分叉的会话排在原会话后面、缩进一层（my app 里有等你确认的任务，文件夹默认展开）。
    const fork = myApp.getByTestId("sidebar-session").filter({ hasText: "分叉出来接着排查" });
    const parent = myApp.getByTestId("sidebar-session").filter({ hasText: "在终端里排查内存泄漏" });
    await expect(fork).toHaveAttribute("data-depth", "1");
    await expect(parent).not.toHaveAttribute("data-depth");
    const [parentBox, forkBox] = [await parent.boundingBox(), await fork.boundingBox()];
    expect(forkBox!.y).toBeGreaterThan(parentBox!.y);
    expect(forkBox!.x).toBeGreaterThan(parentBox!.x);
    // 分叉行标题前有分叉图标，缩进处有引导线。
    await expect(fork.locator(".sb-row-fork")).toBeVisible();
    await expect(parent.locator(".sb-row-fork")).toHaveCount(0);

    // 原会话那一行有收起 / 展开分叉的箭头（issue #9，2026-11-09）：点一下分叉不见了，提示里写藏了几个；再点一下回来。
    const forkToggle = parent.getByTestId("sidebar-fork-toggle");
    await expect(fork.getByTestId("sidebar-fork-toggle")).toHaveCount(0);
    await expect(forkToggle).toHaveAttribute("aria-expanded", "true");
    await expect(forkToggle).toHaveAttribute("aria-label", "收起 1 个分叉");
    await forkToggle.click();
    await expect(fork).toHaveCount(0);
    await expect(forkToggle).toHaveAttribute("aria-expanded", "false");
    await expect(forkToggle).toHaveAttribute("title", "展开 1 个分叉");
    await forkToggle.click();
    await expect(fork).toHaveCount(1);
    await expect(forkToggle).toHaveAttribute("aria-expanded", "true");
    // 键盘：箭头按钮 Enter 翻转；行上 ←/→ 收起 / 展开。
    await forkToggle.focus();
    await page.keyboard.press("Enter");
    await expect(fork).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(fork).toHaveCount(1);
    await parent.locator(".sb-row-main").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(fork).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(fork).toHaveCount(1);
    // 搜索时收起不算数：收起后搜分叉的标题照样搜得到。
    await forkToggle.click();
    await expect(fork).toHaveCount(0);
    await sidebar.getByTestId("sidebar-search").fill("排查");
    await expect(fork).toHaveCount(1);
    await expect(parent.getByTestId("sidebar-fork-toggle")).toHaveAttribute("aria-expanded", "true");
    await sidebar.getByTestId("sidebar-search").fill("");
    await expect(fork).toHaveCount(0);
    await forkToggle.click();
    await expect(fork).toHaveCount(1);

    // 历史会话右键归档：从列表里消失，出现"已归档"，里面列着它。
    await expect(sidebar.getByTestId("sidebar-history-by-archived")).toHaveCount(0);
    await parent.click({ button: "right" });
    await page.getByRole("menuitem", { name: "归档" }).click();
    await expect(parent).toHaveCount(0);
    await sidebar.getByTestId("sidebar-history-by-archived").click();
    await expect(sidebar.getByTestId("sidebar-session")).toHaveText([/在终端里排查内存泄漏/]);
    // 归档了的会话的菜单只有"删除会话…"（点开就是恢复，issue #10）：先弹 danger 确认框，取消不删；确认后经主进程删掉，行消失。
    // 主进程的 deleteSession 换成桩：真的删要起 omp 发 `/delete`（主进程的流程在 test/task-pool.test.ts「删除会话」）；桩只把文件删掉。
    await app.evaluate(
      ({ ipcMain }, file) => {
        const calls: [string, unknown[]][] = Reflect.get(globalThis, "__calls");
        ipcMain.removeHandler("studio:deleteSession");
        ipcMain.handle("studio:deleteSession", (_event, ...args: unknown[]) => {
          calls.push(["deleteSession", args]);
          process.getBuiltinModule("node:fs").rmSync(file);
        });
      },
      path.join(bucketA, "a_terminal.jsonl"),
    );
    const archivedRow = sidebar.getByTestId("sidebar-session").filter({ hasText: "在终端里排查内存泄漏" });
    await archivedRow.click({ button: "right" });
    await expect(page.getByRole("menuitem")).toHaveText(["删除会话…"]);
    await page.getByTestId("session-menu-delete").click();
    const dialog = page.getByTestId("delete-session-dialog");
    await expect(dialog).toContainText("在终端里排查内存泄漏");
    await dialog.getByTestId("delete-session-dialog-cancel").click();
    await expect(dialog).toHaveCount(0);
    expect(await mainCalls(app, "deleteSession")).toEqual([]);
    await archivedRow.click({ button: "right" });
    await page.getByTestId("session-menu-delete").click();
    await page.getByTestId("delete-session-dialog-confirm").click();
    await expect(archivedRow).toHaveCount(0);
    expect(await mainCalls(app, "deleteSession")).toEqual([["sess-terminal"]]);

    // 任务菜单（侧栏右键）最后一项是"删除会话…"，红字；取消不删。
    await myApp.getByTestId("task-row").filter({ hasText: "整理日志格式" }).click({ button: "right" });
    await expect(page.getByRole("menuitem").last()).toHaveText("删除会话…");
    await expect(page.getByTestId("task-menu-delete")).toHaveAttribute("data-tone", "danger");
    await page.getByTestId("task-menu-delete").click();
    await expect(page.getByTestId("delete-session-dialog")).toContainText("整理日志格式");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("delete-session-dialog")).toHaveCount(0);
    expect(await mainCalls(app, "deleteTask")).toEqual([]);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});
