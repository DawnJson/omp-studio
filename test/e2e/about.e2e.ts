// 设置 → 关于：版本号来自 package.json；开发版（未打包）明确显示不检查更新，检查按钮不可用。
// 真机的检查/下载/安装流程见 docs/architecture/auto-update.md 的本地验证。
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, screenshotsDir } from "./launch.ts";

test("关于页显示当前版本；开发版说明不检查更新", async () => {
  const { version } = JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "..", "package.json"), "utf8"));
  const launched = await launchApp();
  try {
    const { page } = launched;
    await page.waitForSelector("[data-testid=app-root]");
    await page.keyboard.press("Control+Comma");
    await page.getByTestId("settings-nav-about").click();

    await expect(page.getByTestId("app-version")).toHaveText(version);
    await expect(page.getByTestId("update-status")).toContainText("不检查更新");
    await expect(page.getByTestId("update-check")).toBeDisabled();
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
    for (const [locale, theme] of [
      ["zh-CN", "light"],
      ["zh-CN", "dark"],
      ["en", "light"],
      ["en", "dark"],
    ] as const) {
      await page.evaluate(
        async ({ locale, theme }) => {
          await globalThis.studio.setLocale(locale);
          await globalThis.studio.setTheme(theme);
        },
        { locale, theme },
      );
      await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", locale);
      // 关于页上面还有 omp 的卡片和更新日志：问题排查在最下面。
      await page.getByTestId("about-troubleshoot").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshotsDir, `about-troubleshoot-${locale}-${theme}.png`) });
    }

    const file = path.join(out, "诊断.txt");
    await app.evaluate(({ dialog, shell }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      shell.showItemInFolder = () => {};
    }, file);
    await page.getByTestId("export-diagnostics").click();
    await expect(page.getByText("Diagnostics exported")).toBeVisible();

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
