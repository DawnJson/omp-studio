import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, screenshotsDir, seedFakeSessions, type LaunchedApp } from "./launch.ts";

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

test("顶栏是任务条：标志+字标、切换侧栏按钮、关于菜单按钮；中段只有标题（不带项目名）；没有后退/前进按钮", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await expect(page.getByTestId("topbar-sidebar")).toBeVisible();
    await expect(page.getByTestId("topbar-menu")).toBeVisible();
    await expect(page.getByTestId("logo").first()).toBeVisible();
    await expect(page.getByTestId("topbar-crumb")).toHaveText(/^(新任务|New task)$/);
    for (const id of ["topbar-back", "topbar-forward"]) await expect(page.getByTestId(id)).toHaveCount(0);
    // 三样横排在同一行：标志在最左，后面依次是切换侧栏、关于。
    const [logo, sidebar, menu] = await Promise.all(
      [page.getByTestId("logo").first(), page.getByTestId("topbar-sidebar"), page.getByTestId("topbar-menu")].map(
        (locator) => locator.boundingBox(),
      ),
    );
    expect((logo?.x ?? 0) < (sidebar?.x ?? 0) && (sidebar?.x ?? 0) < (menu?.x ?? 0)).toBe(true);
    expect(
      Math.abs((sidebar?.y ?? 0) + (sidebar?.height ?? 0) / 2 - ((menu?.y ?? 0) + (menu?.height ?? 0) / 2)),
    ).toBeLessThanOrEqual(1);

    // 页面第一个 Tab 停靠点是切换侧栏按钮（标志不是按钮）。启动后焦点在草稿输入框（spec §5.3），blur 后 Chromium 仍从输入框接着走，
    // 所以按文档顺序找第一个可聚焦控件，再确认它确实能拿到焦点。
    const firstStop = await page.evaluate(
      `(() => [...document.querySelectorAll("button, input, textarea, select, a[href], [tabindex]")]
        .find((el) => el.tabIndex >= 0 && !el.disabled && !el.closest("[inert]") && el.getClientRects().length > 0)
        ?.getAttribute("data-testid"))()`,
    );
    expect(firstStop).toBe("topbar-sidebar");
    await page.getByTestId("topbar-menu").focus();
    await expect(page.getByTestId("topbar-menu")).toBeFocused();
    const topbar = await page.getByTestId("topbar").boundingBox();
    expect(topbar?.height).toBe(40);
  } finally {
    await launched.close();
  }
});

test("侧栏开关：顶栏按钮和 Ctrl B 都能收起/展开", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    const root = page.getByTestId("app-root");
    const toggle = page.getByTestId("topbar-sidebar");
    await expect(root).toHaveAttribute("data-sidebar", "shown");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(root).toHaveAttribute("data-sidebar", "hidden");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Control+b");
    await expect(root).toHaveAttribute("data-sidebar", "shown");
  } finally {
    await launched.close();
  }
});

test("侧栏底部的语言、主题菜单：选了立即生效，Esc 关闭后焦点回到按钮；关于菜单里只有帮助与反馈和关于", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await settled(page, "zh-CN", "light");
    await page.getByTestId("topbar-menu").click();
    const appMenu = page.getByTestId("app-menu");
    await expect(appMenu.getByRole("menuitem")).toHaveText(["帮助与反馈", "关于 omp-studio"]);
    // 菜单在"关于"按钮正下方。
    const [trigger, menuBox] = await Promise.all([
      page.getByTestId("topbar-menu").boundingBox(),
      appMenu.boundingBox(),
    ]);
    expect(Math.abs((menuBox?.x ?? 0) - (trigger?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(menuBox?.y ?? 0).toBeGreaterThanOrEqual((trigger?.y ?? 0) + (trigger?.height ?? 0));
    await page.keyboard.press("Escape");

    await page.getByTestId("sidebar-theme").click();
    const themeMenu = page.getByTestId("sidebar-theme-menu");
    // 打开后焦点在当前选中项上。
    await expect(themeMenu.getByRole("menuitemradio", { name: "浅色" })).toBeFocused();
    await themeMenu.getByRole("menuitemradio", { name: "深色" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(themeMenu).toHaveCount(0);

    await page.getByTestId("sidebar-language").click();
    await page.getByTestId("sidebar-language-menu").getByRole("menuitemradio", { name: "English" }).click();
    await expect(page.getByTestId("topbar-menu")).toHaveText("About");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // 菜单在按钮上方、不出窗口。
    await page.getByTestId("sidebar-theme").click();
    const [button, menu] = await Promise.all([
      page.getByTestId("sidebar-theme").boundingBox(),
      page.getByTestId("sidebar-theme-menu").boundingBox(),
    ]);
    expect(button && menu && menu.y + menu.height).toBeLessThanOrEqual(button?.y ?? 0);
    expect(menu && menu.x).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sidebar-theme-menu")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-theme")).toBeFocused();

    await page.keyboard.press("Alt");
    await expect(page.getByTestId("app-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("app-menu")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-theme")).toBeFocused();
  } finally {
    await launched.close();
  }
});

test("快捷键 Ctrl , 打开设置，Alt+←/→ 在视图之间后退/前进", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await expect(page.getByTestId("topbar")).toBeVisible();
    await page.keyboard.press("Control+,");
    await expect(page.getByTestId("settings")).toBeVisible();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("settings")).toBeVisible();
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
    await page.keyboard.press("Control+b");
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
    await first.page.keyboard.press("Control+b");
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

test("没有项目时主区只有标志和草稿输入框；F6 把焦点送进侧栏", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    const empty = page.getByTestId("empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("data-kind", "no-project");
    await expect(empty.getByTestId("pixel-logo")).toBeVisible();
    // 输入框上面只有标志：没有“还没有项目”、没有最近的任务、没有任何按钮；项目按钮在输入框下面，写"无项目"，不出现 chats。
    await expect(empty.locator(".empty-main").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("draft-composer").getByTestId("empty-project")).toHaveText(/^(无项目|No project)$/);
    await expect(page.getByTestId("empty-draft").locator("[data-composer-input]")).toBeVisible();

    await page.keyboard.press("F6");
    await expect(page.locator("nav.sb :focus")).toHaveCount(1);
  } finally {
    await launched.close();
  }
});

/** 把系统"选择文件夹"对话框换成直接返回 dir，再点侧栏的"添加项目"，得到一个有项目的空状态。 */
async function addProjectViaStubbedDialog(launched: LaunchedApp, dir: string): Promise<void> {
  await launched.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, dir);
  await launched.page.getByTestId("sidebar-add-project").click();
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
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "no-project");
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

    // 项目菜单：键盘打开，向上弹（按钮贴着窗口底部）；Esc 关闭后焦点回到项目按钮。
    await page.getByTestId("empty-project").focus();
    await page.keyboard.press("Enter");
    const projectMenu = page.getByRole("menu");
    await expect(projectMenu).toBeVisible();
    const [projectButton, projectMenuBox] = await Promise.all([
      page.getByTestId("empty-project").boundingBox(),
      projectMenu.boundingBox(),
    ]);
    expect((projectMenuBox?.y ?? 0) + (projectMenuBox?.height ?? 0)).toBeLessThanOrEqual(projectButton?.y ?? 0);
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
