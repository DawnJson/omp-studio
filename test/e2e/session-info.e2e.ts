// 会话信息、请求记录、置顶排序、分享确认、TSP 错误卡重试的端到端（docs/design/spec.md §4.31）。
// 假 omp 是 fake-tsp-omp，回放 fixtures/tsp/error-turn.jsonl（omp 18.12.5，无效 key → 401：一条用户消息和一张 omp.error 卡）。
// stats.db 是临时库（PI_CONFIG_DIR 绝对路径 → <dir>/stats.db，statsDbPath 的规则），表结构抄自 omp；agent 目录里放置顶文件和历史会话。
// 打开对话框时主进程会让 omp 同步一次统计（`omp stats --json`），这里的假 omp 不实现它：同步失败只显示一行提示，
// 已读到的数据不受影响，所以下面的断言不依赖同步完成。分享的 IPC（getShareSettings / shareTask）在主进程里桩掉，**绝不连真实 share 服务器**。
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import { expandSidebarFolders, launchApp, openTaskRow, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");

const SESSION_ID = "01a15fb4-10fe-76f9-a8c3-5ff8fbc9f1be";
const FIRST_PROMPT = "Reply with exactly: hello";

const SCHEMA = `
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_file TEXT NOT NULL, entry_id TEXT NOT NULL, folder TEXT NOT NULL,
  model TEXT NOT NULL, provider TEXT NOT NULL, api TEXT NOT NULL, timestamp INTEGER NOT NULL, duration INTEGER, ttft INTEGER,
  stop_reason TEXT NOT NULL, error_message TEXT, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
  premium_requests REAL NOT NULL, cost_input REAL NOT NULL, cost_output REAL NOT NULL, cost_cache_read REAL NOT NULL,
  cost_cache_write REAL NOT NULL, cost_total REAL NOT NULL, cost_no_cache_input REAL,
  agent_type TEXT NOT NULL DEFAULT 'main', cost_unpriced INTEGER NOT NULL DEFAULT 0, service_tier TEXT,
  UNIQUE(session_file, entry_id)
);
CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_file TEXT NOT NULL, entry_id TEXT NOT NULL, tool_call_id TEXT NOT NULL,
  folder TEXT NOT NULL, tool_name TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, timestamp INTEGER NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'main', calls_in_turn INTEGER NOT NULL DEFAULT 1, args_chars INTEGER NOT NULL DEFAULT 0,
  result_chars INTEGER, is_error INTEGER, UNIQUE(session_file, tool_call_id)
);
CREATE TABLE session_rollup (
  session_file TEXT PRIMARY KEY, requests INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL, cost_total REAL NOT NULL, unpriced INTEGER NOT NULL, models TEXT, tool_calls INTEGER NOT NULL
) WITHOUT ROWID;
`;

interface Started {
  launched: LaunchedApp;
  agentDir: string;
  sessionFile: string;
  project: string;
  received(): Promise<Record<string, unknown>[]>;
  cleanup(): Promise<void>;
}

function seedStats(dbPath: string, sessionFile: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  db.prepare("INSERT INTO session_rollup VALUES (?, 2, 1000, 9000, 1234, 0.0456, 0, 'deepseek-v4-flash', 1)").run(
    sessionFile,
  );
  const message = db.prepare(
    `INSERT INTO messages (session_file, entry_id, folder, model, provider, api, timestamp, duration, ttft, stop_reason,
       error_message, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, premium_requests,
       cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total, agent_type)
     VALUES (?, ?, 'C:/work/project', 'deepseek-v4-flash', 'deepseek', 'openai-completions', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 0, ?, 'main')`,
  );
  message.run(sessionFile, "req-ok", 2_000, 5712, 3048, "toolUse", null, 400, 150, 550, 0.03);
  message.run(sessionFile, "req-fail", 1_000, null, null, "error", "401 Authentication Fails", 0, 0, 0, 0);
  db.prepare(
    `INSERT INTO tool_calls (session_file, entry_id, tool_call_id, folder, tool_name, model, provider, timestamp, args_chars, result_chars, is_error)
     VALUES (?, 'req-ok', 'c1', 'C:/work/project', 'web_search', 'deepseek-v4-flash', 'deepseek', 2000, 12, 340, 0)`,
  ).run(sessionFile);
  db.close();
}

async function start(
  pinned: string[] = [],
  options: { fixture?: string; interrupted?: boolean } = {},
): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp session info e2e "));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const agentDir = path.join(work, "agent");
  const bucket = path.join(agentDir, "sessions", "--e2e--");
  await mkdir(bucket, { recursive: true });
  const header = (id: string) =>
    `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-10-21T10:00:00.000Z", cwd: project })}\n`;
  const user = (text: string) =>
    `${JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user", content: [{ type: "text", text }] } })}\n`;
  const sessionFile = path.join(bucket, `2026-10-21T10-00-00-000Z_${SESSION_ID}.jsonl`);
  // 会话文件里有一条带用量的回复：概览的用量从它算（和输入框同口径），不再读 stats.db 的 session_rollup。
  const reply = {
    type: "message",
    id: "a0",
    parentId: "u1",
    message: {
      role: "assistant",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      stopReason: "stop",
      content: [{ type: "text", text: "hello" }],
      usage: { input: 400, output: 150, cacheRead: 0, cacheWrite: 0, totalTokens: 550, cost: { total: 0.0456 } },
    },
  };
  await writeFile(sessionFile, header(SESSION_ID) + user(FIRST_PROMPT) + `${JSON.stringify(reply)}\n`, "utf8");
  // 两个还没挂任务的历史会话：新的叫 history-new，旧的叫 history-old（置顶文件里放的是旧的）。
  for (const [id, title, age] of [
    ["hist-new", "history-new", 1],
    ["hist-old", "history-old", 5],
  ] as const) {
    const file = path.join(bucket, `2026-10-2${age}T00-00-00-000Z_${id}.jsonl`);
    await writeFile(file, header(id) + user(title), "utf8");
    const modified = new Date(Date.now() - age * 60 * 60 * 1000);
    await utimes(file, modified, modified);
  }
  if (options.interrupted) {
    // 停在工具调用上的历史会话（omp session-listing 的 interrupted）：侧栏给虚线圈暂停号。
    const file = path.join(bucket, "2026-10-20T00-00-00-000Z_hist-int.jsonl");
    const toolCall = {
      type: "message",
      id: "a1",
      parentId: "u1",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
      },
    };
    await writeFile(file, header("hist-int") + user("history-interrupted") + `${JSON.stringify(toolCall)}\n`, "utf8");
  }
  await writeFile(path.join(agentDir, "session-pins.json"), JSON.stringify(pinned), "utf8");
  const configDir = path.join(work, "config");
  await mkdir(configDir);
  seedStats(path.join(configDir, "stats.db"), sessionFile);
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({
      command: process.execPath,
      args: [fakeOmp, options.fixture ?? "error-turn", "--speed=20", `--log=${log}`],
    }),
    PI_CODING_AGENT_DIR: agentDir,
    PI_CONFIG_DIR: configDir,
    FAKE_TSP_SESSION_FILE: sessionFile,
  });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await launched.page.getByTestId("sidebar-open-folder").click();
  await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
  return {
    launched,
    agentDir,
    sessionFile,
    project,
    async received() {
      const text = await readFile(log, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
        .filter((record) => record.kind === "tsp" && record.body !== undefined)
        .map((record) => record.body as Record<string, unknown>)
        .filter((body) => body["ev"] === "send");
    },
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

/** 建任务、发第一句（和录制里的 send 逐字相同）；错误卡出现、任务回到空闲。 */
async function runErrorTurn(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const [project] = await globalThis.studio.listProjects();
    await globalThis.studio.createTask({ projectId: project!.id });
  });
  await openTaskRow(page);
  await page.getByTestId("composer-input").fill(FIRST_PROMPT);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="tsp-view"] [data-role="omp.error"]')).toBeVisible({ timeout: 30_000 });
}

test("会话信息：顶栏任务菜单和 /session 都打开；概览有 ID、文件、用量（从会话文件算）；置顶开关读 session-pins.json", async () => {
  test.setTimeout(120_000);
  const { launched, sessionFile, cleanup } = await start([SESSION_ID]);
  try {
    const { page } = launched;
    await runErrorTurn(page);
    await page.getByTestId("task-menu").click();
    await page.getByRole("menuitem", { name: /会话信息|Session info/ }).click();
    const dialog = page.getByTestId("session-info-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("si-id")).toHaveText(SESSION_ID);
    await expect(dialog.getByTestId("si-file")).toHaveText(sessionFile);
    await expect(dialog.getByTestId("si-requests")).toHaveText("1");
    await expect(dialog.getByTestId("si-cost")).toHaveText("$0.05");
    // 置顶文件里有这个会话：开关是开的。
    await expect(dialog.getByTestId("si-pin")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // /session：同一个对话框。
    await page.getByTestId("composer-input").fill("/session");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("session-info-dialog")).toBeVisible();
    await expect(page.getByTestId("si-id")).toHaveText(SESSION_ID);
  } finally {
    await cleanup();
  }
});

test("请求记录：/trace 打开请求记录页签；每个请求一行（从新到旧），出错行带标记，详情默认折叠", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await runErrorTurn(page);
    await page.getByTestId("composer-input").fill("/trace");
    await page.keyboard.press("Enter");
    const rows = page.getByTestId("trace-row");
    await expect(rows).toHaveCount(2);
    // 时间戳大的在前：req-ok（调用工具）在 req-fail（出错）前面。
    await expect(rows.nth(0)).not.toHaveAttribute("data-failed", /.*/);
    await expect(rows.nth(1)).toHaveAttribute("data-failed", "true");
    await expect(page.getByTestId("trace-summary")).toContainText("2");
    // 详情（耗时、首字、速度、工具）默认折叠，点"详情"带动画展开。
    const toggle = rows.nth(0).getByTestId("trace-details-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(rows.nth(0)).not.toContainText("web_search");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(rows.nth(0)).toContainText("web_search");
    await rows.nth(1).getByTestId("trace-details-toggle").click();
    await expect(rows.nth(1)).toContainText("401 Authentication Fails");
  } finally {
    await cleanup();
  }
});

test("侧栏历史：omp 置顶的历史会话排在更新的那条前面", async () => {
  test.setTimeout(60_000);
  const { launched, cleanup } = await start(["hist-old"]);
  try {
    const { page } = launched;
    await expandSidebarFolders(page);
    const sessions = page.getByTestId("sidebar-session");
    await expect(sessions.first()).toContainText("history-old");
    // 项目里还有刚写入的“Reply with exactly: hello”会话（最新，没置顶）排第二；置顶的旧会话仍在它和 history-new 前面。
    await expect(sessions.nth(1)).toContainText("hello");
    await expect(sessions.nth(2)).toContainText("history-new");
  } finally {
    await cleanup();
  }
});

test("分享：确认框说明服务器和脱敏；取消什么都不发；确认才调 shareTask，显示链接（主进程里桩掉，不连真实服务器）", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start();
  try {
    const { page, app } = launched;
    await app.evaluate(({ ipcMain }) => {
      const state = globalThis as unknown as { __shareCalls?: unknown[][] };
      state.__shareCalls = [];
      ipcMain.removeHandler("studio:getShareSettings");
      ipcMain.handle("studio:getShareSettings", () => ({
        serverUrl: "https://share.example.test/s",
        store: "blob",
        redactSecrets: true,
      }));
      ipcMain.removeHandler("studio:shareTask");
      ipcMain.handle("studio:shareTask", (_event, ...args: unknown[]) => {
        state.__shareCalls?.push(args);
        return { url: "https://share.example.test/s/abc123#key", gistUrl: null, text: "" };
      });
    });
    const calls = () =>
      app.evaluate(() => (globalThis as unknown as { __shareCalls: unknown[][] }).__shareCalls.length);
    await runErrorTurn(page);
    await page.getByTestId("composer-input").fill("/share");
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("share-dialog");
    await expect(dialog.getByTestId("share-warning")).toContainText("share.example.test");
    await expect(dialog.getByTestId("share-redact")).toHaveCount(0);
    // 取消：框关了，没有任何上传调用。
    await page.getByRole("button", { name: /取消|Cancel/ }).click();
    await expect(dialog).toHaveCount(0);
    expect(await calls()).toBe(0);
    // 再开，确认：调用一次（gist 为 false），链接显示出来。
    await page.getByTestId("composer-input").fill("/share");
    await page.keyboard.press("Enter");
    await page.getByTestId("share-confirm").click();
    await expect(page.getByTestId("share-url")).toHaveText("https://share.example.test/s/abc123#key");
    expect(await calls()).toBe(1);
    await expect(page.getByTestId("share-copy")).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("重试：回放的 TSP 错误卡下面有“重试”按钮；点击给 omp 发 /retry", async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start();
  try {
    const { page } = launched;
    await runErrorTurn(page);
    const retry = page.getByTestId("retry-turn");
    await expect(retry).toBeVisible({ timeout: 15_000 });
    await retry.click();
    // 假 omp 只回放录制里的事件；/retry 不在录制里，它被忽略，但"收到了什么"照样记在日志里。
    await expect
      .poll(async () => (await received()).map((event) => event["text"]), { timeout: 15_000 })
      .toEqual([FIRST_PROMPT, "/retry"]);
  } finally {
    await cleanup();
  }
});

test("请求记录页：“在浏览器中打开”给任务的 omp 发 /trace（omp 自己开浏览器），提示 omp 已打开", async () => {
  test.setTimeout(120_000);
  // trace-link 录制：slash-status 的握手 + 真实 omp 18.12.6 对 /trace 回的 toast（Trace: http://127.0.0.1:3847/#/traces?s=…）。
  const { launched, received, cleanup } = await start([], { fixture: "trace-link" });
  try {
    const { page } = launched;
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    await openTaskRow(page);
    await page.getByTestId("task-menu").click();
    await page.getByRole("menuitem", { name: /会话信息|Session info/ }).click();
    await page.getByRole("tab", { name: /请求记录|Requests/ }).click();
    const open = page.getByTestId("trace-open");
    await expect(open).toBeVisible();
    await open.click();
    await expect(page.getByText(/omp 已在浏览器中打开请求记录|omp opened the request trace/)).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(async () => (await received()).map((event) => event["text"])).toContain("/trace");
  } finally {
    await cleanup();
  }
});

test("侧栏历史：停在工具调用上的会话画虚线圈暂停号，悬停有说明（omp session-listing 的 interrupted）", async () => {
  test.setTimeout(60_000);
  const { launched, cleanup } = await start([], { interrupted: true });
  try {
    const { page } = launched;
    await expandSidebarFolders(page);
    const row = page.getByTestId("sidebar-session").filter({ hasText: "history-interrupted" });
    const mark = row.locator(".sb-dot-interrupted");
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute("title", /中途停下|Stopped partway/);
  } finally {
    await cleanup();
  }
});
