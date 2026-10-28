// 设置 → 关于：版本号来自 package.json；开发版（未打包）明确显示不检查更新，检查按钮不可用。
// 真机的检查/下载/安装流程见 docs/architecture/auto-update.md 的本地验证。
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { ProjectId, TaskId, TaskState, UpdateState } from "../../src/shared/ipc.ts";
import { emptySessionToggles } from "../../src/shared/omp-output/toggles.ts";
import { expectNoOverflow, launchApp, setLocaleTheme } from "./launch.ts";

test("关于页显示当前版本；开发版说明不检查更新；omp-studio 右边的 GitHub 图标用系统浏览器打开项目仓库", async () => {
  const { version } = JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "..", "package.json"), "utf8"));
  const launched = await launchApp();
  try {
    const { app, page } = launched;
    await page.waitForSelector("[data-testid=app-root]");
    await page.keyboard.press("Control+Comma");
    await page.getByTestId("settings-nav-about").click();

    await expect(page.getByTestId("app-version")).toHaveText(version);
    await expect(page.getByTestId("update-status")).toContainText("不检查更新");
    await expect(page.getByTestId("update-check")).toBeDisabled();

    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { openedUrls: string[] }).openedUrls = opened;
      shell.openExternal = async (url: string) => {
        opened.push(url);
      };
    });
    const repo = page.getByTestId("about-info").getByTestId("about-repo");
    await expect(repo).toHaveAccessibleName("在 GitHub 上查看项目");
    await repo.click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { openedUrls: string[] }).openedUrls))
      .toEqual(["https://github.com/DawnJson/omp-studio"]);

    // 900 宽、中英文下这一行都不越界（名字 + 图标 + 版本 + 更新状态 + 检查按钮）。
    await page.setViewportSize({ width: 900, height: 800 });
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      await expectNoOverflow(page.getByTestId("about-info"));
    }
  } finally {
    await launched.close();
  }
});

test("导出诊断信息：一个文件里有版本、omp 状态和日志，不含用户名和家目录；日志写在 userData/logs", async () => {
  const { version } = JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "..", "package.json"), "utf8"));
  const out = await mkdtemp(path.join(os.tmpdir(), "omp-studio 诊断 "));
  const launched = await launchApp();
  try {
    const { app, page } = launched;
    await page.waitForSelector("[data-testid=app-root]");
    await page.keyboard.press("Control+Comma");
    await page.getByTestId("settings-nav-about").click();
    await expect(page.getByTestId("about-troubleshoot")).toBeVisible();

    const file = path.join(out, "诊断.txt");
    await app.evaluate(({ dialog, shell }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      shell.showItemInFolder = () => {};
    }, file);
    await page.getByTestId("export-diagnostics").click();
    await expect.poll(async () => (await readFile(file, "utf8").catch(() => "")).length).toBeGreaterThan(0);

    const text = await readFile(file, "utf8");
    expect(text).toContain(`app: ${version}`);
    expect(text).toContain("## omp");
    expect(text).toMatch(/## main-\d{4}-\d{2}-\d{2}\.log\n.*omp-studio .* starting/);
    expect(text.toLowerCase()).not.toContain(os.homedir().toLowerCase());
    expect(text.toLowerCase()).not.toContain(os.homedir().toLowerCase().replaceAll("\\", "\\\\"));
    expect(
      (await readdir(path.join(launched.userDataDir, "logs"))).some((name) =>
        /^main-\d{4}-\d{2}-\d{2}\.log$/.test(name),
      ),
    ).toBe(true);
  } finally {
    await launched.close();
    await rm(out, { recursive: true, force: true });
  }
});

type App = Awaited<ReturnType<typeof launchApp>>["app"];

const updateIdle: UpdateState = {
  currentVersion: "0.0.1",
  latestVersion: null,
  phase: "idle",
  percent: 0,
  lastCheckedAt: null,
  error: null,
  disabledReason: null,
};
const updateDownloaded: UpdateState = { ...updateIdle, latestVersion: "9.9.9", phase: "downloaded" };

function makeTask(status: TaskState["status"]): TaskState {
  return {
    id: "t1" as TaskId,
    projectId: "p1" as ProjectId,
    title: "重构数据层",
    status,
    unread: false,
    lastTurn: null,
    error: null,
    createdAt: 1,
    updatedAt: 1,
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
    restartable: false,
    loaderText: null,
    prNumber: null,
    contextCompaction: null,
    composerMode: null,
    extStatuses: [],
  };
}

/** 主进程里替换更新状态、任务列表和安装通道；installUpdate 只计数，不真的安装。 */
async function stubUpdate(app: App, update: UpdateState, tasks: TaskState[]): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, data) => {
      Reflect.set(globalThis, "__update", data.update);
      Reflect.set(globalThis, "__tasks", data.tasks);
      Reflect.set(globalThis, "__installs", 0);
      for (const [name, result] of [
        ["getUpdateState", () => Reflect.get(globalThis, "__update")],
        ["listTasks", () => Reflect.get(globalThis, "__tasks")],
        [
          "installUpdate",
          () => {
            Reflect.set(globalThis, "__installs", Number(Reflect.get(globalThis, "__installs")) + 1);
          },
        ],
      ] as const) {
        ipcMain.removeHandler(`studio:${name}`);
        ipcMain.handle(`studio:${name}`, result);
      }
    },
    { update, tasks },
  );
}

const installCalls = (app: App) => app.evaluate(() => Number(Reflect.get(globalThis, "__installs")));

test("更新下载好后侧栏出现新版本标签；有任务在进行时先确认，取消不安装，没有就直接安装；900 宽中英文不越界", async () => {
  const launched = await launchApp();
  try {
    const { app, page } = launched;
    await page.waitForSelector("[data-testid=app-root]");
    await stubUpdate(app, updateIdle, [makeTask("running")]);
    await page.reload();
    await page.waitForSelector("[data-testid=app-root]");

    const chip = page.getByTestId("sidebar-update");
    const dialog = page.getByTestId("update-install-dialog");
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(chip).toHaveCount(0);

    // 下载完成：标签出现，写着版本号，不弹窗。
    await app.evaluate(({ BrowserWindow }, state) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("studio:event:updateState", state);
      Reflect.set(globalThis, "__update", state);
    }, updateDownloaded);
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("新版本 9.9.9");
    await expect(chip).toHaveAttribute("title", "重启并安装");
    await expect(dialog).toHaveCount(0);

    // 有任务在进行：确认框；取消不安装；再点一次确认才安装。
    await chip.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("重启会中断 1 个正在进行的任务");
    await expect(dialog).toContainText("重启后可以在侧栏的历史会话里继续它们");
    await expect(page.getByTestId("update-install-dialog-cancel")).toHaveText("稍后");
    await expect(page.getByTestId("update-install-dialog-confirm")).toHaveText("重启并安装");
    await page.getByTestId("update-install-dialog-cancel").click();
    await expect(dialog).toHaveCount(0);
    expect(await installCalls(app)).toBe(0);
    await chip.click();
    await page.getByTestId("update-install-dialog-confirm").click();
    await expect.poll(() => installCalls(app)).toBe(1);

    // 没有任务在进行：直接安装，不弹框。
    await app.evaluate(
      (_electron, tasks) => {
        Reflect.set(globalThis, "__tasks", tasks);
      },
      [makeTask("idle")],
    );
    await page.reload();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect.poll(() => installCalls(app)).toBe(2);
    await expect(dialog).toHaveCount(0);

    // 设置 → 关于：状态写明退出时自动安装，按钮同样直接安装；返回任务。
    await page.keyboard.press("Control+Comma");
    await page.getByTestId("settings-nav-about").click();
    await expect(page.getByTestId("update-status")).toHaveText("新版本 9.9.9 已下载，退出时自动安装");
    await page.getByTestId("update-install").click();
    await expect.poll(() => installCalls(app)).toBe(3);
    await expect(dialog).toHaveCount(0);
    await page.getByTestId("settings-back").click();
    await expect(chip).toBeVisible();

    // 900 宽、中英文下侧栏（含标签）都不越界，标签仍然看得见版本号。
    await page.setViewportSize({ width: 900, height: 800 });
    for (const [locale, label] of [
      ["zh-CN", "新版本 9.9.9"],
      ["en", "Update 9.9.9"],
    ] as const) {
      await setLocaleTheme(page, locale, "light");
      await expect(chip).toHaveText(label);
      await expectNoOverflow(page.getByTestId("sidebar"));
    }
  } finally {
    await launched.close();
  }
});
