// 设置 → 关于：版本号来自 package.json；开发版（未打包）明确显示不检查更新，检查按钮不可用。
// 真机的检查/下载/安装流程见 docs/architecture/auto-update.md 的本地验证。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./launch.ts";

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
