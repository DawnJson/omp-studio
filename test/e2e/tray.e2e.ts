// 托盘常驻的端到端：窗口 × 只隐藏，主进程和任务继续跑；再次启动应用把窗口带回来，对话接着走；
// 真正退出（和托盘菜单"退出"同一条 app.quit() 路径）时 omp 子进程不留残留。
// 托盘图标和右键菜单由系统绘制，Playwright 点不到：菜单模板在 test/tray-model.test.ts 里单测。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import electronPath from "electron";
import { expect, test } from "@playwright/test";
import { loadTspFixture, recordedUserEvents } from "../tsp-fixtures.ts";
import { launchApp, openTaskRow, testOmp, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** approval 录制里用户发的那句话：发出后 omp 停在"等你确认"（任务不会自己结束，窗口隐藏期间一直在"跑"）。 */
const PROMPT = (recordedUserEvents(loadTspFixture("approval"))[0]?.event as { text?: string } | undefined)?.text ?? "";

async function start(): Promise<{
  launched: LaunchedApp;
  pidFile: string;
  cleanup(): Promise<void>;
}> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 托盘 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const pidFile = path.join(work, "omp-pids.txt");
  const launched = await launchApp({
    STUDIO_TEST_OMP: testOmp("approval"),
    FAKE_OMP_PID_FILE: pidFile,
  });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  return {
    launched,
    pidFile,
    cleanup: () => rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

async function sendPrompt(launched: LaunchedApp): Promise<void> {
  const { page } = launched;
  await page.evaluate(async () => {
    const project = await globalThis.studio.addProject();
    if (!project) throw new Error("addProject 没有返回项目");
    await globalThis.studio.createTask({ projectId: project.id });
  });
  await openTaskRow(page);
  const input = page.getByTestId("composer-input");
  await expect(input).toBeVisible();
  await input.fill(PROMPT);
  await page.keyboard.press("Enter");
}

const windowVisible = (launched: LaunchedApp) =>
  launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible()));

/** 点窗口 ×（BrowserWindow.close()，和系统关闭按钮同一条 close 事件路径）。 */
const closeWindow = (launched: LaunchedApp) =>
  launched.app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.close();
  });

async function readPids(file: string): Promise<number[]> {
  const text = await readFile(file, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map(Number);
}

test("关窗口只隐藏：主进程和 omp 还活着，任务还在；再次启动应用把窗口带回，对话接着走", async () => {
  const { launched, pidFile, cleanup } = await start();
  try {
    const { page } = launched;
    await sendPrompt(launched);
    await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
    const [ompPid] = await readPids(pidFile);
    expect(ompPid).toBeGreaterThan(0);

    await closeWindow(launched);
    await expect.poll(() => windowVisible(launched)).toBe(false);
    // 主进程还在响应；omp 子进程还在；"仍在托盘运行"的提示只提示一次，记在 window-state.json。
    const mainPid = await launched.app.evaluate(() => process.pid);
    expect(isAlive(mainPid)).toBe(true);
    expect(isAlive(ompPid as number)).toBe(true);
    const state = JSON.parse(await readFile(path.join(launched.userDataDir, "window-state.json"), "utf8")) as {
      trayNoticeShown?: boolean;
    };
    expect(state.trayNoticeShown).toBe(true);

    // 隐藏期间任务仍在主进程里：停在"等你确认"（渲染进程仍然收得到事件）。
    await expect
      .poll(() => page.evaluate(async () => (await globalThis.studio.listTasks())[0]?.status), { timeout: 20_000 })
      .toBe("needs_you");

    // 第二个实例启动：拿不到单实例锁，通知第一个实例后自己退出。
    const { ELECTRON_RENDERER_URL: _dev, ...baseEnv } = process.env;
    await new Promise<void>((resolve, reject) => {
      execFile(
        electronPath as unknown as string,
        [root],
        { env: { ...baseEnv, STUDIO_USER_DATA: launched.userDataDir }, cwd: root, timeout: 30_000 },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    await expect.poll(() => windowVisible(launched)).toBe(true);

    // 对话停在隐藏前的那个任务上，审批还在等。
    await expect(page.getByTestId("tsp-view")).toBeVisible();
    expect(isAlive(ompPid as number)).toBe(true);
  } finally {
    await launched.close();
    await cleanup();
  }
});

test("任务还在跑时退出（等同托盘“退出”的 app.quit()）：窗口不再拦，omp 子进程不留残留", async () => {
  const { launched, pidFile, cleanup } = await start();
  const exited = new Promise<void>((resolve) => launched.app.process().once("exit", () => resolve()));
  try {
    await sendPrompt(launched);
    await expect(launched.page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
    const [ompPid] = await readPids(pidFile);
    expect(ompPid).toBeGreaterThan(0);

    await closeWindow(launched);
    await expect.poll(() => windowVisible(launched)).toBe(false);
    expect(isAlive(ompPid as number)).toBe(true);

    // 和托盘菜单“退出”的 click 同一个调用：app.quit() → before-quit → 关 omp → 真正退出。
    await launched.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await exited;
    await expect.poll(() => isAlive(ompPid as number), { timeout: 10_000 }).toBe(false);
  } finally {
    await launched.close();
    await cleanup();
  }
});
