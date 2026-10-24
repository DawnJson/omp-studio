// 设置 → 关于：版本号来自 package.json；开发版（未打包）明确显示不检查更新，检查按钮不可用。
// 真机的检查/下载/安装流程见 docs/architecture/auto-update.md 的本地验证。
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
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
