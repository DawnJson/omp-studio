// 现有界面的对照图：启动构建产物（先 npm run build），在主进程里把任务和对话替换成和五个方向相同的数据，
// 截"对话页 / 新任务页 × 浅 / 深"四张到 screenshots/design-refresh/now-*.png。做法同 test/e2e/sidebar.e2e.ts。
// 用法（仓库根目录）：node docs/design/ui-refresh/preview/capture-current.ts
import path from "node:path";
import { launchApp, screenshotsDir } from "../../../../test/e2e/launch.ts";
import { applyTranscriptEvent, emptyTranscript, type TranscriptEvent } from "../../../../src/shared/transcript.ts";
import type { ProjectId, TaskId, TaskState } from "../../../../src/shared/ipc.ts";

const out = path.join(screenshotsDir, "design-refresh");
const now = Date.now();
const sec = 1000;
const min = 60 * sec;

const projectA = { id: "pa" as ProjectId, path: "E:\\work\\omp-studio", name: "omp-studio" };
const projectB = { id: "pb" as ProjectId, path: "E:\\work\\blog", name: "blog" };
const model = {
  key: { provider: "deepseek", modelId: "deepseek-v4-flash" },
  name: "DeepSeek V4 Flash",
  contextWindow: 200_000,
  reasoning: true,
  acceptsImages: false,
  maxTokens: 393_216,
  thinkingEfforts: ["low", "medium", "high"],
  cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
};

function task(id: string, projectId: ProjectId, title: string, ageMin: number, patch: Partial<TaskState> = {}): TaskState {
  return {
    id: id as TaskId,
    projectId,
    title,
    status: "idle",
    unread: false,
    lastTurn: null,
    error: null,
    createdAt: now - ageMin * min,
    updatedAt: now - ageMin * min,
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
    contextParts: null,
    ...patch,
  } as TaskState;
}

const tasks: TaskState[] = [
  task("t1", projectA.id, "修复登录页的 bug", 0, {
    status: "running",
    model: model as TaskState["model"],
    thinkingLevel: "high",
    thinkingLevels: ["off", "low", "medium", "high"],
    contextUsage: { tokens: 68_000, contextWindow: 200_000, percent: 34 } as TaskState["contextUsage"],
    sessionUsage: {
      tokens: { input: 40_000, output: 8_000, cacheRead: 64_000, cacheWrite: 0, total: 112_000 },
      cost: 0.21,
      premiumRequests: 0,
    } as TaskState["sessionUsage"],
    cwd: projectA.path,
    runStartedAt: now - 42 * sec,
  }),
  task("t2", projectA.id, "重构数据层", 5, { status: "needs_you", runStartedAt: now - 5 * min }),
  task("t3", projectA.id, "整理日志格式", 40, { unread: true }),
  task("t4", projectA.id, "升级依赖", 120, { status: "error", error: { kind: "exited", message: "omp 退出了" } as TaskState["error"] }),
  task("t5", projectB.id, "写发布说明", 60 * 24),
  task("t6", projectB.id, "迁移到 Astro", 60 * 24 * 3),
];

/* ───────── 对话：和 common.mjs 里的 D 一致 ───────── */
// edit/write 参数用相对路径：改动卡片按相对项目的路径显示（tool-info.ts 的 relativeToProject）。
const diff = (a: number, d: number) =>
  ["--- a", "+++ b", ...Array.from({ length: d }, () => "-old"), ...Array.from({ length: a }, () => "+new")].join("\n");
const usage = { input: 4000, output: 600, cacheRead: 9000, cacheWrite: 0, totalTokens: 13600, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } };
const assistant = (content: unknown[], at: number, stop: string) => ({
  role: "assistant",
  content,
  api: "openai-completions",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  usage,
  stopReason: stop,
  timestamp: at,
});

type Tool = { id: string; name: string; args: Record<string, unknown>; intent: string; result?: unknown; running?: boolean };
const t0 = now - 6 * min;
const tools1: Tool[] = [
  { id: "c1", name: "grep", args: { pattern: "requestSubmit", path: "src" }, intent: "Searching submit calls" },
  { id: "c2", name: "read", args: { path: "src/login/form.ts" }, intent: "Reading login form" },
  { id: "c3", name: "read", args: { path: "src/login/submit.ts" }, intent: "Reading submit helper" },
  { id: "c4", name: "task", args: { tasks: [{ task: "check Safari support" }] }, intent: "Checking Safari support" },
  { id: "c5", name: "read", args: { path: "test/login.test.ts" }, intent: "Reading existing tests" },
  { id: "c6", name: "edit", args: { path: "src/login/form.ts" }, intent: "Editing login form", result: { content: [], details: { diff: diff(31, 6) } } },
  { id: "c7", name: "edit", args: { path: "src/login/submit.ts" }, intent: "Adding fallback", result: { content: [], details: { diff: diff(9, 0) } } },
  { id: "c8", name: "write", args: { path: "test/login.test.ts", content: "a\nb\nc\nd\ne\nf\ng\nh\n" }, intent: "Writing tests" },
  { id: "c9", name: "bash", args: { command: "npm test" }, intent: "Running tests" },
  { id: "c10", name: "read", args: { path: "src/login/form.ts" }, intent: "Re-reading form" },
  { id: "c11", name: "bash", args: { command: "npm run lint" }, intent: "Running lint" },
  { id: "c12", name: "bash", args: { command: "npm test" }, intent: "Running tests again" },
];
const final =
  "原因是表单提交用了 `requestSubmit()`，Safari 15.4 以下不支持，点击被静默吞掉了。\n\n" +
  "- 改为在 `submit` 事件里统一处理，旧版本走 `form.submit()` 回退\n" +
  "- 新增 `login.test.ts`，覆盖按钮提交和回车提交两条路径\n" +
  "- `npm test` 41 项全部通过";

const events: TranscriptEvent[] = [];
const push = (e: unknown) => events.push(e as TranscriptEvent);
push({ type: "run_start", at: t0 });
push({ type: "message_end", key: "u1", message: { role: "user", content: [{ type: "text", text: "登录页在 Safari 上点「登录」没反应，帮我查一下原因并修好，顺便补个测试。" }], timestamp: t0 }, at: t0 });
tools1.forEach((tool, i) => {
  const at = t0 + (i + 1) * 10 * sec;
  push({ type: "message_end", key: `a${i}`, message: assistant([{ type: "toolCall", id: tool.id, name: tool.name, arguments: tool.args, intent: tool.intent }], at, "toolUse"), at });
  push({ type: "tool_start", toolCallId: tool.id, toolName: tool.name, args: tool.args, intent: tool.intent, at });
  if (tool.name === "task") push({ type: "subagent", id: "sa1", status: "started", at });
  push({ type: "tool_end", toolCallId: tool.id, result: tool.result ?? { content: [{ type: "text", text: "ok" }] }, isError: false, at: at + 4 * sec });
});
const t1End = t0 + 134 * sec;
push({ type: "message_end", key: "final", message: assistant([{ type: "text", text: final }], t1End, "stop"), at: t1End });
push({ type: "run_end", at: t1End, yielded: false });
push({ type: "settled", at: t1End });
const t2 = now - 42 * sec;
push({ type: "message_end", key: "u2", message: { role: "user", content: [{ type: "text", text: "把表单的错误提示也改成中文。" }], timestamp: t2 }, at: t2 });
push({ type: "run_start", at: t2 });
const live = { id: "d1", name: "edit", args: { path: "src/login/messages.ts" }, intent: "正在编辑 src/login/messages.ts" };
push({ type: "message_end", key: "b0", message: assistant([{ type: "toolCall", id: live.id, name: live.name, arguments: live.args, intent: live.intent }], t2 + 5 * sec, "toolUse"), at: t2 + 5 * sec });
push({ type: "tool_start", toolCallId: live.id, toolName: live.name, args: live.args, intent: live.intent, at: t2 + 5 * sec });
const transcript = events.reduce(applyTranscriptEvent, emptyTranscript());

/* ───────── 截图 ───────── */
const launched = await launchApp();
const { app, page } = launched;
try {
  await app.evaluate(
    ({ ipcMain }, data) => {
      const stub = (name: string, result: (...args: unknown[]) => unknown) => {
        ipcMain.removeHandler(`studio:${name}`);
        ipcMain.handle(`studio:${name}`, (_event, ...args: unknown[]) => result(...args));
      };
      stub("getAppInfo", () => ({
        version: "0.3.14",
        platform: "win32",
        locale: "zh-CN",
        isPackaged: false,
        runtime: { electron: "0", chromium: "0", node: "0" },
      }));
      stub("listProjects", () => data.projects);
      stub("listTasks", () => data.tasks);
      stub("openTask", (taskId) => ({ taskId, seq: 0, transcript: data.transcript }));
      stub("getShellState", () => ({ sidebarWidth: 264, sidebarCollapsed: false }));
      stub("setShellState", () => undefined);
    },
    { projects: [projectA, projectB], tasks, transcript },
  );
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.reload();
    const sidebar = page.getByTestId("sidebar");
    await sidebar.getByTestId("task-row").filter({ hasText: "修复登录页的 bug" }).locator(".sb-row-main").click();
    await page.getByText("已更改").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `now-conversation-${scheme}.png`) });
    // 整段对话（过程全部展开时有多长）：把窗口临时拉高到放得下整段，截完再还原。
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 2000));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `now-conversation-full-${scheme}.png`) });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 800));
    await page.waitForTimeout(300);

    await sidebar.getByRole("button", { name: /新任务/ }).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `now-empty-${scheme}.png`) });
  }
  console.log("完成：现有界面 4 张 → " + out);
} finally {
  await launched.close();
}
