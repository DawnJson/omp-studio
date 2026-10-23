import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoOverflow, launchApp, seedFakeSessions, setLocaleTheme, type LaunchedApp } from "./launch.ts";

test("顶栏是任务条：标志+字标、切换侧栏按钮（没有关于按钮）；中段只有标题（不带项目名）；没有后退/前进按钮", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await expect(page.getByTestId("topbar-sidebar")).toBeVisible();
    // 左上角的标志和新任务页同一个像素标志（π + 像素字 omp studio），不带版本号。
    const brand = page.getByTestId("topbar-brand");
    await expect(brand.getByTestId("pixel-logo")).toBeVisible();
    await expect(brand.getByTestId("pixel-logo-version")).toHaveCount(0);
    await expect(page.getByTestId("topbar-crumb")).toHaveText(/^(新任务|New task)$/);
    for (const id of ["topbar-back", "topbar-forward"]) await expect(page.getByTestId(id)).toHaveCount(0);
    // 两样横排在同一行：标志在最左，后面是切换侧栏。顶栏左侧没有"关于与反馈"按钮。
    await expect(page.getByTestId("topbar-about")).toHaveCount(0);
    const [logo, sidebar] = await Promise.all(
      [brand, page.getByTestId("topbar-sidebar")].map((locator) => locator.boundingBox()),
    );
    expect((logo?.x ?? 0) < (sidebar?.x ?? 0)).toBe(true);

    // 页面第一个 Tab 停靠点是切换侧栏按钮（标志不是按钮）。启动后焦点在草稿输入框（spec §5.3），blur 后 Chromium 仍从输入框接着走，
    // 所以按文档顺序找第一个可聚焦控件，再确认它确实能拿到焦点。
    const firstStop = await page.evaluate(
      `(() => [...document.querySelectorAll("button, input, textarea, select, a[href], [tabindex]")]
        .find((el) => el.tabIndex >= 0 && !el.disabled && !el.closest("[inert]") && el.getClientRects().length > 0)
        ?.getAttribute("data-testid"))()`,
    );
    expect(firstStop).toBe("topbar-sidebar");
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

test("侧栏底部只有设置（没有语言、主题菜单）；命令面板里切换主题 / 语言还在；关于与反馈从命令面板打开，页脚按钮右对齐；单按 Alt 不触发任何动作", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await setLocaleTheme(page, "zh-CN", "light");
    for (const id of ["sidebar-theme", "sidebar-language"]) await expect(page.getByTestId(id)).toHaveCount(0);
    const bottom = page.getByTestId("sidebar").locator(".sb-bottom");
    await expect(bottom.getByRole("button")).toHaveCount(1);
    await expect(bottom.locator(".sb-settings")).toBeVisible();

    await page.keyboard.press("Control+k");
    const palette = page.getByTestId("command-palette");
    await palette.getByRole("combobox").fill("关于与反馈");
    await expect(palette.getByRole("option").first()).toContainText("关于与反馈");
    await page.keyboard.press("Enter");
    const about = page.getByTestId("about-dialog");
    await expect(about).toBeVisible();
    // 关于：ui/Dialog sm，标题 omp-studio、版本（带 omp 版本）；页脚两个按钮右对齐，Tab 在框内循环。
    await expect(about.getByRole("heading", { level: 2 })).toHaveText("omp-studio");
    await expect(about.getByTestId("about-version")).toContainText("版本 ");
    await expect(about.locator(".ui-dialog-foot").getByRole("button")).toHaveText(["复制版本信息", "报告问题"]);
    const [dialogBox, reportBox] = await Promise.all([
      about.boundingBox(),
      about.getByTestId("about-report").boundingBox(),
    ]);
    expect((reportBox?.x ?? 0) + (reportBox?.width ?? 0)).toBeGreaterThan(
      (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) - 40,
    );
    await page.keyboard.press("Escape");
    await expect(about).toHaveCount(0);

    // 命令面板里切换主题 / 语言保留。
    await page.keyboard.press("Control+k");
    await palette.getByRole("combobox").fill("语言");
    await expect(palette.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");

    // 单按 Alt、Ctrl+Alt+A（QQ/微信截图等全局热键吞掉字母后，应用只看到 Alt 按下抬起）都不触发任何动作。
    await page.keyboard.press("Alt");
    await page.keyboard.down("Control");
    await page.keyboard.down("Alt");
    await page.keyboard.up("Alt");
    await page.keyboard.up("Control");
    await expect(page.getByTestId("about-dialog")).toHaveCount(0);
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

test("侧栏默认 240 宽；磁盘上存着旧默认 264 的按新默认处理，拖出来的宽度原样保留，越界的回到默认", async () => {
  const sidebarWidth = async (stored: number | null): Promise<number> => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-sbw-"));
    try {
      if (stored !== null) {
        await writeFile(
          path.join(userDataDir, "window-state.json"),
          JSON.stringify({ shell: { sidebarWidth: stored } }),
          "utf8",
        );
      }
      const launched = await launchApp({ STUDIO_USER_DATA: userDataDir });
      try {
        const { page, app } = launched;
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800));
        await expect(page.getByTestId("app-root")).toHaveAttribute("data-sidebar", "shown");
        const resizer = page.getByTestId("sidebar-resizer");
        await expect(resizer).toBeVisible();
        // 侧栏列有宽度过渡：等 aria-valuenow 稳定再量。
        const value = Number(await resizer.getAttribute("aria-valuenow"));
        await expect
          .poll(async () => page.evaluate(`document.querySelector(".sidebar-column").getBoundingClientRect().width`))
          .toBe(value);
        return value;
      } finally {
        await launched.close();
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
  };
  expect(await sidebarWidth(null)).toBe(240);
  expect(await sidebarWidth(264)).toBe(240);
  expect(await sidebarWidth(300)).toBe(300);
  expect(await sidebarWidth(210)).toBe(210);
  expect(await sidebarWidth(100)).toBe(240);
});

test("全局滚动条：滚动时挂 data-scrolling、停后摘掉，出现和消失不改内容宽度；不画横向滚动条", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await page.evaluate(`(() => {
      const box = document.createElement("div");
      box.setAttribute("data-testid", "probe-scroll");
      box.style.cssText = "position:fixed;right:40px;top:120px;width:260px;height:180px;overflow:auto;z-index:9999";
      box.innerHTML = Array.from({ length: 40 }, (_, i) => "<div>line " + i + "</div>").join("") +
        '<div style="white-space:pre">' + "x".repeat(300) + "</div>";
      document.body.appendChild(box);
    })()`);
    const probe = page.getByTestId("probe-scroll");
    interface Box {
      clientWidth: number;
      clientHeight: number;
      offsetHeight: number;
      scrollWidth: number;
      scrollTop: number;
    }
    const widthOf = () => probe.evaluate((el) => (el as unknown as Box).clientWidth);
    const widthBefore = await widthOf();
    await expect(probe).not.toHaveAttribute("data-scrolling", "");
    await probe.evaluate((el) => {
      (el as unknown as Box).scrollTop = 60;
    });
    await expect(probe).toHaveAttribute("data-scrolling", "");
    expect(await widthOf()).toBe(widthBefore);
    // 滚动条停 800ms 后淡出（属性摘掉）。
    await expect(probe).not.toHaveAttribute("data-scrolling", "", { timeout: 3000 });
    expect(await widthOf()).toBe(widthBefore);
    // 里面有 300 个字符不折行的长行：能横向滚（scrollWidth 更大），但没有横向滚动条（下沿没被占高）。
    const metrics = await probe.evaluate((el) => {
      const box = el as unknown as Box;
      return { overflowX: box.scrollWidth - box.clientWidth, barHeight: box.offsetHeight - box.clientHeight };
    });
    expect(metrics.overflowX).toBeGreaterThan(0);
    expect(metrics.barHeight).toBe(0);
  } finally {
    await launched.close();
  }
});

test("设置、侧栏折叠和窗口尺寸写入 userData，重启后恢复", async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-shell-"));
  try {
    const first = await launchApp({ STUDIO_USER_DATA: userDataDir });
    await setLocaleTheme(first.page, "en", "dark");
    await first.page.keyboard.press("Control+b");
    await expect(first.page.getByTestId("app-root")).toHaveAttribute("data-sidebar", "hidden");
    await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 700));
    // 用 LaunchedApp.close()：它连 launchApp 自己建的临时目录一起删（app.close() 只关进程，目录会漏）。
    await first.close();

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
      await second.close();
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("字号：设置里选一档立即整体缩放（含三键区高度），重启保持，快捷键/滚轮/重载都改不动", async () => {
  const zoomFactor = (launched: LaunchedApp) =>
    launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor());
  // 页面里量：缩放后 devicePixelRatio 按比例变大，三键区（titlebar-area）仍恰好是 40 CSS px 高（主进程把三键区高度一起放大）。
  const measure = (launched: LaunchedApp) =>
    launched.page.evaluate(() => {
      const browser = globalThis as unknown as {
        devicePixelRatio: number;
        navigator: { windowControlsOverlay?: { getTitlebarAreaRect(): { height: number } } };
      };
      return {
        dpr: browser.devicePixelRatio,
        titlebarArea: browser.navigator.windowControlsOverlay?.getTitlebarAreaRect().height ?? 0,
      };
    });
  const first = await launchApp();
  let second: LaunchedApp | undefined;
  try {
    await expect(first.page.getByTestId("topbar")).toBeVisible();
    const base = await measure(first);
    expect(await zoomFactor(first)).toBe(1);
    expect(base.titlebarArea).toBe(40);

    await first.page.keyboard.press("Control+,");
    await expect(first.page.getByTestId("settings")).toBeVisible();
    await first.page.getByTestId("settings-nav-general").click();
    const option = first.page.getByTestId("setting-font-size").getByRole("radio", { name: "125%" });
    await option.click();
    await expect.poll(() => zoomFactor(first)).toBe(1.25);
    await expect(option).toBeChecked();
    const scaled = await measure(first);
    expect(scaled.dpr / base.dpr).toBeCloseTo(1.25, 2);
    expect(scaled.titlebarArea).toBe(40);

    // Ctrl +/-、Ctrl+滚轮、重载都不改变档位。
    await first.page.keyboard.press("Control+=");
    await first.page.keyboard.press("Control+-");
    await first.page.keyboard.down("Control");
    await first.page.mouse.wheel(0, -300);
    await first.page.keyboard.up("Control");
    await first.page.reload();
    await expect(first.page.getByTestId("app-root")).toBeAttached();
    await expect.poll(() => zoomFactor(first)).toBe(1.25);
    await first.app.close();

    const stored = JSON.parse(await readFile(path.join(first.userDataDir, "settings.json"), "utf8")) as {
      fontScale: number;
    };
    expect(stored.fontScale).toBe(125);

    // 重启（同一个 userData）：还是 125%，三键区高度也跟着。
    const next = await launchApp({ STUDIO_USER_DATA: first.userDataDir });
    second = next;
    await expect.poll(() => zoomFactor(next)).toBe(1.25);
    await expect.poll(async () => (await measure(next)).titlebarArea).toBe(40);
    expect((await measure(next)).dpr / base.dpr).toBeCloseTo(1.25, 2);
  } finally {
    await second?.close().catch(() => {});
    await first.close();
  }
});

test("字号最大档（150%）在 900 宽窗口下：主界面和设置页都不越界（中英文）", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await page.evaluate(() => globalThis.studio.setFontScale(150));
    await expect
      .poll(() =>
        launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor()),
      )
      .toBe(1.5);
    await page.setViewportSize({ width: 900, height: 700 });
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      await expectNoOverflow(page.getByTestId("app-root"));
    }
    await page.keyboard.press("Control+,");
    const settings = page.getByTestId("settings");
    await expect(settings).toBeVisible();
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      // 150% 下窗口只剩 600 CSS px：设置导航可能是侧栏按钮，也可能收成下拉；两种都逐节走一遍。
      const nav = page.getByTestId("settings-nav");
      if (await nav.isVisible()) {
        const items = nav.locator('button[data-testid^="settings-nav-"]');
        const count = await items.count();
        expect(count).toBeGreaterThan(3);
        for (let index = 0; index < count; index++) {
          await items.nth(index).click();
          await expectNoOverflow(settings);
        }
      } else {
        const select = page.getByTestId("settings-nav-select");
        const options = page.getByTestId("settings-nav-select-list").getByRole("option");
        await select.click();
        const count = await options.count();
        expect(count).toBeGreaterThan(3);
        for (let index = 0; index < count; index++) {
          if (index > 0) await select.click();
          await options.nth(index).click();
          await expectNoOverflow(settings);
        }
      }
    }
  } finally {
    await launched.close();
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

test("没有项目时主区只有标志和草稿输入框；F6 把焦点送进侧栏", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    const empty = page.getByTestId("empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("data-kind", "no-project");
    await expect(empty.getByTestId("pixel-logo")).toBeVisible();
    // 输入框上面只有标志：没有“还没有项目”、没有最近的任务、没有任何按钮；项目标签在输入框工具行里，写默认文件夹的路径。
    await expect(empty.locator(".empty-main").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("draft-composer").locator(".composer-tools").getByTestId("empty-project")).toHaveText(
      /[\\/]chats$/,
    );
    await expect(page.getByTestId("empty-draft").locator("[data-composer-input]")).toBeVisible();

    await page.keyboard.press("F6");
    await expect(page.locator("nav.sb :focus")).toHaveCount(1);
  } finally {
    await launched.close();
  }
});

/** 把系统"选择文件夹"对话框换成直接返回 dir，再点侧栏的"打开文件夹"，得到一个有项目的空状态。 */
async function addProjectViaStubbedDialog(launched: LaunchedApp, dir: string): Promise<void> {
  await launched.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, dir);
  await launched.page.getByTestId("sidebar-open-folder").click();
  await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
}

test("有项目的空状态：输入框贴主区底部、没有历史会话列表；拖入事件切换草稿项目", async () => {
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

    // 草稿期间 Ctrl N 不创建任务，回到默认文件夹（不沿用刚才选的项目）。
    await page.keyboard.press("Control+n");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "no-project");
    expect(await page.evaluate(() => globalThis.studio.listTasks())).toEqual([]);

    // Ctrl F 聚焦侧栏搜索框并全选；悬停提示出现在行上（默认隐藏）。
    const search = page.getByTestId("sidebar-search");
    await page.getByTestId("empty-draft").locator("[data-composer-input]").focus();
    await search.fill("abc");
    await page.keyboard.press("Control+n");
    await page.keyboard.press("Control+f");
    await expect(search).toBeFocused();
    expect(await search.evaluate((el) => (el as unknown as { selectionEnd: number }).selectionEnd)).toBe(3);
    await search.fill("");
    // Ctrl Shift O = 点“打开文件夹”：对话框被桩成 projectDir，草稿切到它；之后 Ctrl N 回到默认文件夹。
    await page.keyboard.press("Control+Shift+O");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    await expect(page.getByTestId("empty-project")).toHaveAttribute("title", projectDir);
    await page.keyboard.press("Control+n");
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "no-project");
    // 三行的快捷键提示默认隐藏，悬停才出现。先把鼠标移开：前面添加项目时点过“打开文件夹”这一行，鼠标还停在上面。
    const hint = page.getByTestId("sidebar-open-folder").locator(".sb-new-hint");
    await expect(hint).toHaveText("Ctrl Shift O");
    await page.getByTestId("main-panel").hover();
    await expect(hint).toHaveCSS("opacity", "0");
    await page.getByTestId("sidebar-open-folder").hover();
    await expect(hint).toHaveCSS("opacity", "1");

    // 工具行的项目标签只显示、不能点（不是按钮），写默认文件夹的路径，悬停提示同一个完整路径。
    const label = page.getByTestId("empty-project");
    await expect(label).toHaveText(/[\\/]chats$/);
    expect(await label.evaluate((el) => (el as unknown as { tagName: string }).tagName)).toBe("SPAN");
    await expect(label).toHaveAttribute("title", /[\\/]chats$/);
    // 换项目走侧栏项目分组旁的 ＋。
    await page.getByTestId("sidebar-project-new").first().click();
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    await expect(label).toContainText("omp studio 项目");
    await expect(label).toHaveAttribute("title", projectDir);

    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 640));
    await expect(page.getByTestId("app-root")).toHaveAttribute("data-drawer", "true");
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
