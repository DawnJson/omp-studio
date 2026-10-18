import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, screenshotsDir, seedFakeSessions } from "./launch.ts";

const topbarIds = ["topbar-menu", "topbar-sidebar", "topbar-back", "topbar-forward"] as const;

async function settled(page: Page, locale: "zh-CN" | "en", theme: "light" | "dark"): Promise<void> {
  await page.evaluate(
    async ({ locale: nextLocale, theme: nextTheme }) => {
      await globalThis.studio.setLocale(nextLocale);
      await globalThis.studio.setTheme(nextTheme);
    },
    { locale, theme },
  );
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", locale);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

test("顶栏四个按钮存在、按顺序可用键盘聚焦；置灰的后退/前进仍可聚焦", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    for (const id of topbarIds) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("topbar-back")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("topbar-forward")).toHaveAttribute("aria-disabled", "true");

    for (const id of topbarIds) {
      await page.keyboard.press("Tab");
      await expect(page.getByTestId(id)).toBeFocused();
    }
    const topbar = await page.getByTestId("topbar").boundingBox();
    expect(topbar?.height).toBe(40);
  } finally {
    await launched.close();
  }
});

test("侧栏开关：按钮和 Ctrl B 都能收起/展开", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    const root = page.getByTestId("app-root");
    await expect(root).toHaveAttribute("data-sidebar", "shown");
    await page.getByTestId("topbar-sidebar").click();
    await expect(root).toHaveAttribute("data-sidebar", "hidden");
    await page.keyboard.press("Control+b");
    await expect(root).toHaveAttribute("data-sidebar", "shown");
  } finally {
    await launched.close();
  }
});

test("应用菜单：切换主题和语言立即生效；Esc 关闭后焦点回到 ≡", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await settled(page, "zh-CN", "light");
    await page.getByTestId("topbar-menu").click();
    const menu = page.getByTestId("app-menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitemradio", { name: "深色" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByTestId("topbar-menu").click();
    await page.getByTestId("app-menu").getByRole("menuitemradio", { name: "English" }).click();
    await expect(page.getByTestId("topbar-menu")).toHaveAttribute("aria-label", "Menu");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.keyboard.press("Alt");
    await expect(page.getByTestId("app-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("app-menu")).toHaveCount(0);
    await expect(page.getByTestId("topbar-menu")).toBeFocused();
  } finally {
    await launched.close();
  }
});

test("快捷键 Ctrl , 打开设置，后退按钮随之可用并回到上一个视图", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await expect(page.getByTestId("topbar")).toBeVisible();
    await page.keyboard.press("Control+,");
    await expect(page.getByTestId("topbar-back")).toHaveAttribute("aria-disabled", "false");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await expect(page.getByTestId("topbar-forward")).toHaveAttribute("aria-disabled", "false");
  } finally {
    await launched.close();
  }
});

test("窄于 1000px 侧栏变抽屉：开关打开，Esc 收起", async () => {
  const launched = await launchApp();
  try {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 700));
    const root = page.getByTestId("app-root");
    await expect(root).toHaveAttribute("data-drawer", "true");
    await expect(root).toHaveAttribute("data-sidebar", "hidden");
    await page.getByTestId("topbar-sidebar").click();
    await expect(root).toHaveAttribute("data-sidebar", "shown");
    await expect(page.getByTestId("drawer-scrim")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(root).toHaveAttribute("data-sidebar", "hidden");
  } finally {
    await launched.close();
  }
});

test("设置、侧栏折叠和窗口尺寸写入 userData，重启后恢复", async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-shell-"));
  try {
    const first = await launchApp({ STUDIO_USER_DATA: userDataDir });
    await settled(first.page, "en", "dark");
    await first.page.getByTestId("topbar-sidebar").click();
    await expect(first.page.getByTestId("app-root")).toHaveAttribute("data-sidebar", "hidden");
    await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 700));
    await first.app.close();

    const settings = JSON.parse(await readFile(path.join(userDataDir, "settings.json"), "utf8")) as {
      locale: string;
      theme: string;
    };
    expect(settings).toMatchObject({ locale: "en", theme: "dark" });

    const second = await launchApp({ STUDIO_USER_DATA: userDataDir });
    try {
      await expect(second.page.getByTestId("app-root")).toHaveAttribute("data-locale", "en");
      await expect(second.page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(second.page.getByTestId("app-root")).toHaveAttribute("data-sidebar", "hidden");
      const width = await second.app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getNormalBounds().width,
      );
      expect(width).toBe(1100);
    } finally {
      await second.app.close();
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("安全：CSP 生效且无违规，权限请求被拒，缩放快捷键无效", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("Content Security Policy")) violations.push(message.text());
    });
    await page.reload();
    await expect(page.getByTestId("app-root")).toBeAttached();

    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(await page.evaluate(() => Notification.requestPermission())).toBe("denied");

    await page.keyboard.press("Control+=");
    await page.keyboard.press("Control+-");
    expect(
      await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel()),
    ).toBe(0);
    expect(violations).toEqual([]);
  } finally {
    await launched.close();
  }
});

test("截图：中英文 × 浅深主题", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    for (const locale of ["zh-CN", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await settled(page, locale, theme);
        await page.waitForTimeout(250);
        await page.screenshot({
          path: path.join(screenshotsDir, `shell-${locale === "zh-CN" ? "zh" : "en"}-${theme}.png`),
        });
      }
    }
  } finally {
    await launched.close();
  }
});

test("没有项目时主区是选文件夹引导；F6 把焦点送进侧栏", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    const empty = page.getByTestId("empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("data-kind", "no-project");
    await expect(page.getByTestId("empty-open-folder")).toBeVisible();

    await page.keyboard.press("F6");
    await expect(page.locator("nav.sb :focus")).toHaveCount(1);
  } finally {
    await launched.close();
  }
});

/** 把系统"选择文件夹"对话框换成直接返回 dir，再点空状态里的"打开文件夹…"，得到一个有项目的空状态。 */
async function addProjectViaStubbedDialog(launched: Awaited<ReturnType<typeof launchApp>>, dir: string): Promise<void> {
  await launched.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, dir);
  await launched.page.getByTestId("empty-open-folder").click();
  await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
}

test("有项目的空状态：输入框贴主区底部、没有历史会话列表；拖入事件切换草稿项目；截图", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "omp studio 项目 "));
  // 假会话的 cwd 就是这个项目目录：空状态里不能再出现它们（历史只在侧栏）。
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-agent-"));
  await seedFakeSessions(agentDir, projectDir);
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  try {
    const { page } = launched;
    await expect(page.getByTestId("empty-open-folder")).toBeVisible();
    await addProjectViaStubbedDialog(launched, projectDir);

    await expect(page.getByTestId("empty-draft").locator("[data-composer-input]")).toBeVisible();
    await expect(page.getByTestId("empty-project")).toContainText("omp studio 项目");
    await expect(page.getByTestId("empty-session")).toHaveCount(0);
    await expect(page.getByTestId("empty-state")).not.toContainText("Fix the flaky login test on CI");
    // 输入框贴在主区底部（和对话时同一位置），不是居中。
    const panel = await page.getByTestId("main-panel").boundingBox();
    const composer = await page.getByTestId("draft-composer").boundingBox();
    expect(panel && composer && panel.y + panel.height - (composer.y + composer.height)).toBeLessThanOrEqual(24);
    expect(composer && panel && composer.y).toBeGreaterThan((panel?.y ?? 0) + (panel?.height ?? 0) / 2);

    // 草稿期间 Ctrl N 回到同一个空状态而不是创建任务。
    await page.keyboard.press("Control+n");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    expect(await page.evaluate(() => globalThis.studio.listTasks())).toEqual([]);

    // 项目菜单：键盘打开，Esc 关闭后焦点回到项目名。
    await page.getByTestId("empty-project").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("empty-project")).toBeFocused();

    await page.locator("[data-composer-input]").focus();
    for (const locale of ["zh-CN", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await settled(page, locale, theme);
        await page.waitForTimeout(250);
        await page.screenshot({
          path: path.join(screenshotsDir, `shell-project-${locale === "zh-CN" ? "zh" : "en"}-${theme}.png`),
        });
      }
    }

    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 640));
    await expect(page.getByTestId("app-root")).toHaveAttribute("data-drawer", "true");
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(screenshotsDir, "shell-project-narrow.png") });
  } finally {
    await launched.close();
    await rm(projectDir, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("拖入文件夹覆盖层：只有拖的是文件夹时出现，离开后消失", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await expect(page.getByTestId("topbar")).toBeVisible();
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([""], "folder", { type: "" }));
      globalThis.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true }));
    });
    await expect(page.getByTestId("drop-overlay")).toBeVisible();
    await page.evaluate(() => globalThis.dispatchEvent(new DragEvent("dragleave", { bubbles: true })));
    await expect(page.getByTestId("drop-overlay")).toHaveCount(0);

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([""], "a.png", { type: "image/png" }));
      globalThis.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true }));
    });
    await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
  } finally {
    await launched.close();
  }
});

test("页面来自 app://studio；路径穿越和越界地址拿不到文件", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await expect(page.getByTestId("app-root")).toBeAttached();
    expect(page.url()).toBe("app://studio/index.html");
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).not.toContain("file:");

    const status = (url: string) =>
      page.evaluate(
        async (target) =>
          fetch(target).then(
            (response) => response.status,
            () => 0,
          ),
        url,
      );
    expect(await status("app://studio/index.html")).toBe(200);
    // 越界读取不会返回内容（路径解析见 test/app-protocol.test.ts）。
    expect(await status("app://studio/%2e%2e/%2e%2e/package.json")).not.toBe(200);
    expect(await status("app://studio/..%5C..%5Cpackage.json")).not.toBe(200);
    // 其他主机被 CSP 的 connect-src self 直接拒绝（fetch 失败，状态 0）。
    expect(await status("app://other/index.html")).toBe(0);
  } finally {
    await launched.close();
  }
});
