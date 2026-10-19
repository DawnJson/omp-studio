// 侧栏 + 命令面板的端到端：启动构建产物，在主进程里替换 listProjects/listTasks 等 IPC 通道为夹具数据
// （任务运行时由别的切片实现，这里只验证界面和键盘），listSessions 走真实的会话索引，读临时目录里造的会话文件
// （路径含空格和中文）。中文浅色 / 英文深色各截一张图，写到 screenshots/。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Locale, ProjectId, TaskId, TaskState } from "../../src/shared/ipc.ts";
import { emptyTranscript } from "../../src/shared/transcript.ts";
import { launchApp, screenshotsDir } from "./launch.ts";

const now = Date.now();
const minute = 60_000;
const projectA = { id: "pa" as ProjectId, path: "E:\\研究 项目\\my app", name: "my app" };
const projectB = { id: "pb" as ProjectId, path: "E:\\work\\api server", name: "api server" };

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
    queue: { steering: [], followUp: [] },
    dialogs: [],
    runningSubagents: 0,
    todoPhases: [],
    cwd: "",
    runStartedAt: null,
    fastMode: { enabled: false, active: false },
    slowMode: { supported: false, enabled: false, scope: null },
    usageLimit: null,
    tokensPerSecond: null,
    goal: null,
    ...patch,
  };
}

const tasks: TaskState[] = [
  makeTask("t1", projectA.id, "修复登录页的 bug", 3, { status: "needs_you" }),
  makeTask("t2", projectA.id, "重构数据层", 8, {
    status: "running",
    runningSubagents: 2,
    runStartedAt: now - 5 * minute,
  }),
  makeTask("t3", projectA.id, "整理日志格式", 40, { unread: true }),
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

async function makeAgentDir(): Promise<string> {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp 会话 agent-"));
  const bucket = path.join(agentDir, "sessions", "--E--研究 项目-my app--");
  await mkdir(bucket, { recursive: true });
  await writeFile(
    path.join(bucket, "a_terminal.jsonl"),
    headerLine("sess-terminal", projectA.path) + userLine("在终端里排查内存泄漏"),
    "utf8",
  );
  await writeFile(path.join(bucket, "b_broken.jsonl"), "{损坏的会话文件\n", "utf8");
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
      stub("getAppInfo", () => ({ version: "0.0.0", platform: "win32", locale: data.locale, isPackaged: false }));
      stub("listProjects", () => data.projects);
      stub("listTasks", () => data.tasks);
      stub("openTask", (taskId) => ({ taskId, seq: 0, transcript: data.transcript }));
      stub("renameTask", () => undefined);
      stub("archiveTask", () => undefined);
      stub("createTask", () => data.tasks[0]);
      stub("listSlashCommands", () => data.slash);
      stub("getShellState", () => ({ sidebarWidth: 264, sidebarCollapsed: false, collapsedProjects: [] }));
      stub("setShellState", () => undefined);
    },
    {
      locale,
      projects: [projectA, projectB],
      tasks,
      transcript: emptyTranscript(),
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

      // 分组：项目名、默认只显示 6 条（my app 有 7 个任务，其中 1 个被收起）。
      await expect(sidebar.getByRole("region", { name: "my app" })).toBeVisible();
      await expect(sidebar.getByRole("region", { name: "api server" })).toBeVisible();
      await expect(sidebar.getByRole("region", { name: "my app" }).getByTestId("task-row")).toHaveCount(6);
      await expect(sidebar.getByTestId("waiting-strip")).toContainText(words.waitingMany);

      // 状态点：形状不同，各有 aria-label。
      await expect(sidebar.locator(".sb-dot-waiting")).toHaveCount(2);
      await expect(sidebar.locator(".sb-dot-running")).toHaveCount(1);
      await expect(sidebar.locator(".sb-dot-done")).toHaveCount(1);
      await expect(sidebar.locator(".sb-dot-error")).toHaveCount(1);

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

      // ← 折叠项目组（任务行消失，任务数出现），→ 再展开。
      const toggle = sidebar.getByRole("region", { name: "my app" }).locator(".sb-group-toggle");
      const rows = sidebar.getByRole("region", { name: "my app" }).getByTestId("task-row");
      // 选中任务后输入框的聚焦是同步的（App 里唯一一处），不需要重试。
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(rows).toHaveCount(0);
      await toggle.focus();
      await page.keyboard.press("ArrowRight");
      await expect(rows).toHaveCount(6);
      // 折叠状态写进主进程的外壳状态（不是 localStorage）；运行中的任务行显示已运行时长。
      expect((await mainCalls(app, "setShellState")).map((args) => args[0])).toContainEqual({
        collapsedProjects: ["pa"],
      });
      await expect(sidebar.getByTestId("task-row").filter({ hasText: "重构数据层" })).toContainText(
        locale === "zh-CN" ? "5 分钟" : "5m",
      );

      await page.screenshot({ path: path.join(screenshotsDir, `sidebar-${locale}-${colorScheme}.png`) });

      // 命令面板：Ctrl K 打开；搜历史会话（来自临时目录的真实索引）；Esc 关闭并还原焦点。
      await sidebar.getByRole("button", { name: locale === "zh-CN" ? "命令面板" : "Command palette" }).click();
      const palette = page.getByTestId("command-palette");
      await expect(palette).toBeVisible();
      await expect(palette.getByRole("combobox")).toBeFocused();
      await page.screenshot({ path: path.join(screenshotsDir, `palette-empty-${locale}-${colorScheme}.png`) });
      await palette.getByRole("combobox").fill(locale === "zh-CN" ? "内存" : "leak");
      if (locale === "zh-CN") {
        await expect(palette.getByRole("group", { name: words.sessions })).toContainText("在终端里排查内存泄漏");
        await page.screenshot({ path: path.join(screenshotsDir, `palette-search-${locale}-${colorScheme}.png`) });
      }
      await palette.getByRole("combobox").fill("");
      // 斜杠命令用主进程给的真实列表；需要参数的命令也在列表里。
      await palette.getByRole("combobox").fill("/comp");
      await expect(palette.getByRole("option")).toHaveCount(1);
      await expect(palette.getByRole("option").first()).toContainText("/compact");
      await palette.getByRole("combobox").fill("");
      await palette.getByRole("combobox").fill("Deploy");
      await expect(palette.getByRole("option").first()).toContainText("Deploy pipeline");
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);

      // 归档：Delete 立刻从侧栏消失，撤销后回来，没撤销的 8 秒后才真正调用 archiveTask。
      const rowByTitle = (page: Page, title: string) => page.getByTestId("task-row").filter({ hasText: title });
      await rowByTitle(page, "整理日志格式").locator(".sb-row-main").focus();
      await page.keyboard.press("Delete");
      await expect(rowByTitle(page, "整理日志格式")).toHaveCount(0);
      await page.getByRole("button", { name: words.undo }).click();
      await expect(rowByTitle(page, "整理日志格式")).toHaveCount(1);
      await rowByTitle(page, "升级依赖").locator(".sb-row-main").focus();
      await page.keyboard.press("Delete");
      await expect(rowByTitle(page, "升级依赖")).toHaveCount(0);
      expect(await mainCalls(app, "archiveTask")).toEqual([]);
      await expect
        .poll(async () => (await mainCalls(app, "archiveTask")).map((args) => args[0]), { timeout: 15_000 })
        .toEqual(["t4"]);
    } finally {
      await launched.close();
      await rm(agentDir, { recursive: true, force: true });
    }
  });
}
