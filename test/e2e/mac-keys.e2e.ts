// mac 分支的端到端（在 Windows 上跑）：只换 getAppInfo 返回的 platform（launch.ts 的 stubPlatform），渲染进程就走 mac 分支——
// 主修饰键是 Cmd（Meta）、快捷键文字是 ⌘ 形式、顶栏左侧给红黄绿三键留位置。真正的 mac 窗口（三键本身、系统菜单）只能在 mac 上看，这里不测。
import { expect, test } from "@playwright/test";
import { expectNoOverflow, launchApp, setStubLocale, stubPlatform } from "./launch.ts";

test("mac：Meta+K 打开命令面板，Control+K 不打开；Windows 默认相反", async () => {
  const launched = await launchApp();
  try {
    const { app, page } = launched;
    const palette = page.getByTestId("command-palette");
    await expect(page.locator("html")).toHaveAttribute("data-platform", "win32");

    // Windows（默认）：Ctrl+K 开，Win/Cmd 键不开。
    await page.keyboard.press("Meta+K");
    await expect(palette).toHaveCount(0);
    await page.keyboard.press("Control+K");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    await stubPlatform(app, page, "darwin");
    await page.keyboard.press("Control+K");
    await expect(palette).toHaveCount(0);
    await page.keyboard.press("Meta+K");
    await expect(palette).toBeVisible();
    // 面板里命令行的快捷键提示也是 ⌘ 形式（空查询时先列出命令）。
    await expect(palette.locator(".ui-kbd", { hasText: "⌘" }).first()).toBeVisible();
    await expect(palette.locator(".ui-kbd", { hasText: "Ctrl" })).toHaveCount(0);
  } finally {
    await launched.close();
  }
});

test("mac：提示、侧栏和设置里的快捷键都是 ⌘ 形式；Windows 默认还是 Ctrl", async () => {
  const launched = await launchApp();
  try {
    const { app, page } = launched;
    const tooltip = page.getByTestId("tooltip");
    const sidebarButton = page.getByTestId("topbar-sidebar");

    await sidebarButton.hover();
    await expect(tooltip.locator(".ui-kbd")).toHaveText("Ctrl B");
    await expect(page.locator(".sb-new-hint").first()).toHaveText("Ctrl N");

    await stubPlatform(app, page, "darwin");
    await sidebarButton.hover();
    await expect(tooltip.locator(".ui-kbd")).toHaveText("⌘B");
    await expect(page.locator(".sb-new-hint").first()).toHaveText("⌘N");
    await expect(page.locator(".sb-new-hint").nth(1)).toHaveText("⌘⇧O");

    // 设置 → 通用 → 快捷键清单：每个键各一个键帽，主修饰键是 ⌘。
    await page.keyboard.press("Meta+,");
    const row = page.locator(".st-kb-row", { has: page.locator(".kbd", { hasText: "⇧" }) }).first();
    await expect(row).toBeVisible();
    // 清单第一组是 studio 自己的键；第二组是转发给 omp 的真 Ctrl 键，保持 Ctrl。
    const studioKeys = page.locator(".st-kb-grid").first();
    await expect(studioKeys.locator(".kbd", { hasText: "Ctrl" })).toHaveCount(0);
    await expect(studioKeys.locator(".kbd", { hasText: "⌘" }).first()).toBeVisible();
  } finally {
    await launched.close();
  }
});

test("mac：顶栏左侧给三键留位置（标志和侧栏按钮从 70px 以右开始），900 宽中英文都不越界", async () => {
  const launched = await launchApp();
  try {
    const { app, page } = launched;
    await page.setViewportSize({ width: 900, height: 800 });
    const left = async (testId: string) => (await page.getByTestId(testId).boundingBox())?.x ?? -1;

    // Windows（默认）：左边没有让位。
    expect(await left("topbar-brand")).toBeLessThan(70);
    expect(await left("topbar-sidebar")).toBeGreaterThan(0);
    const windowsSidebarX = await left("topbar-sidebar");

    await stubPlatform(app, page, "darwin");
    expect(await left("topbar-brand")).toBeGreaterThanOrEqual(70);
    expect(await left("topbar-sidebar")).toBeGreaterThanOrEqual(windowsSidebarX + 60);
    for (const locale of ["zh-CN", "en"] as const) {
      await setStubLocale(app, page, locale);
      await expectNoOverflow(page.getByTestId("topbar"));
    }
    // 侧栏收起（宽度 auto）时同样不越界。
    await page.keyboard.press("Meta+B");
    await expectNoOverflow(page.getByTestId("topbar"));
    expect(await left("topbar-sidebar")).toBeGreaterThanOrEqual(70);
  } finally {
    await launched.close();
  }
});
