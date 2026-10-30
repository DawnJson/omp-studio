// 配色主题（spec §2.1、§4.19）：设置 → 通用 → 外观的主题画廊、背景图 / 毛玻璃设置行、命令面板的"选择主题…"。
// 主题的颜色只从 CSS 里读（tokens.css 的 light / dark、themes.css 的其余），不在测试里另抄一份。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { themeNames, type ThemeName } from "../../src/shared/themes.ts";
import { expectNoOverflow, launchApp, setLocaleTheme } from "./launch.ts";

const stylesDir = path.resolve(import.meta.dirname, "..", "..", "src", "renderer", "styles");

/** 主题块 `[data-theme="<名字>"] {` 里 --bg-app 的值（light / dark 在 tokens.css，其余在 themes.css）。 */
async function cssBgApp(theme: ThemeName): Promise<string> {
  const file = theme === "light" || theme === "dark" ? "tokens.css" : "themes.css";
  const css = await readFile(path.join(stylesDir, file), "utf8");
  const start = css.indexOf(`[data-theme="${theme}"] {`);
  expect(start, `${file} 里没有 ${theme} 的主题块`).toBeGreaterThanOrEqual(0);
  const value = /--bg-app:\s*([^;]+);/.exec(css.slice(start))?.[1]?.trim();
  if (value === undefined) throw new Error(`${theme} 没有 --bg-app`);
  return value;
}

/** #rrggbb → getComputedStyle 的 rgb(r, g, b) 写法。 */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

async function htmlTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const g = globalThis as unknown as { document: { documentElement: { getAttribute(name: string): string | null } } };
    return g.document.documentElement.getAttribute("data-theme");
  });
}

async function rootBgApp(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = globalThis as unknown as {
      document: { documentElement: unknown };
      getComputedStyle(el: unknown): { getPropertyValue(name: string): string };
    };
    return g.getComputedStyle(g.document.documentElement).getPropertyValue("--bg-app").trim();
  });
}

/** 等 React 挂上，切成中文浅色，再经命令面板的"选择主题…"进设置页（顺带测这条命令）。 */
async function openGalleryFromPalette(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.getByTestId("app-root")).toBeVisible();
  await setLocaleTheme(page, "zh-CN", "light");
  await page.keyboard.press("Control+k");
  const palette = page.getByTestId("command-palette");
  await palette.getByRole("combobox").fill("主题");
  await palette.getByRole("option", { name: "选择主题…" }).click();
  await expect(page.getByTestId("settings")).toBeVisible();
  await expect(page.getByTestId("theme-gallery")).toBeVisible();
}

test("主题画廊：跟随系统在最前、其余按登记表的顺序；每张卡的预览用自己主题的颜色；点卡切主题，主进程跟着换深浅", async () => {
  const launched = await launchApp();
  try {
    const { app, page } = launched;
    await openGalleryFromPalette(page);
    const gallery = page.getByTestId("theme-gallery");
    const cards = gallery.getByRole("button");
    await expect(cards).toHaveCount(themeNames.length + 1);
    const order = await cards.evaluateAll((elements) =>
      (elements as unknown as { getAttribute(name: string): string | null }[]).map((element) =>
        element.getAttribute("data-testid"),
      ),
    );
    expect(order).toEqual(["theme-card-system", ...themeNames.map((name) => `theme-card-${name}`)]);

    // 预览块挂 data-theme 就地取色：主区底色就是那个主题的 --bg-app（不管当前界面是什么主题）。
    for (const name of themeNames) {
      const main = page.getByTestId(`theme-card-${name}`).locator(".st-theme-main");
      await expect(main).toHaveCSS("background-color", rgb(await cssBgApp(name)));
    }
    // 跟随系统：左半浅色、右半深色。
    const halves = page.getByTestId("theme-card-system").locator(".st-theme-main");
    await expect(halves).toHaveCount(2);
    await expect(halves.nth(0)).toHaveCSS("background-color", rgb(await cssBgApp("light")));
    await expect(halves.nth(1)).toHaveCSS("background-color", rgb(await cssBgApp("dark")));

    const whale = page.getByTestId("theme-card-whale-dark");
    await whale.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "whale-dark");
    await expect(whale).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("theme-card-light")).toHaveAttribute("aria-pressed", "false");
    expect(await rootBgApp(page)).toBe(await cssBgApp("whale-dark"));
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true);

    await page.getByTestId("theme-card-sakura").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sakura");
    await expect(whale).toHaveAttribute("aria-pressed", "false");
    expect(await rootBgApp(page)).toBe(await cssBgApp("sakura"));
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(false);

    // 跟随系统 = <html> 上没有 data-theme。
    await page.getByTestId("theme-card-system").click();
    await expect.poll(() => htmlTheme(page)).toBeNull();
    await expect(page.getByTestId("theme-card-system")).toHaveAttribute("aria-pressed", "true");
  } finally {
    await launched.close();
  }
});

test("外观的设置行：背景图选不用时没有浓度；不支持毛玻璃的系统上没有毛玻璃开关；900 宽、中英文下外观不越界", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await openGalleryFromPalette(page);

    // 默认背景图 = 主题插图：有浓度，没有"更换图片"（只在自选图片时有）。
    const strength = page.getByTestId("setting-backdrop-strength");
    await expect(page.getByTestId("setting-backdrop-theme")).toHaveAttribute("aria-checked", "true");
    await expect(strength).toBeVisible();
    await expect(page.getByTestId("setting-backdrop-choose")).toHaveCount(0);
    await page.getByTestId("setting-backdrop-none").click();
    await expect(page.getByTestId("setting-backdrop-none")).toHaveAttribute("aria-checked", "true");
    await expect(strength).toHaveCount(0);
    await page.getByTestId("setting-backdrop-theme").click();
    await expect(strength).toBeVisible();
    await page.getByTestId("setting-backdrop-strength-high").click();
    await expect(page.getByTestId("setting-backdrop-strength-high")).toHaveAttribute("aria-checked", "true");

    // 毛玻璃开关跟着这台机器的 AppInfo.glassSupported（Windows 11 22H2 起才有）。
    const { glassSupported } = await page.evaluate(() => globalThis.studio.getAppInfo());
    const glass = page.getByTestId("setting-glass");
    if (glassSupported) {
      await expect(glass).toHaveAttribute("aria-checked", "false");
      await glass.click();
      await expect(glass).toHaveAttribute("aria-checked", "true");
      await glass.click();
      await expect(glass).toHaveAttribute("aria-checked", "false");
    } else {
      await expect(glass).toHaveCount(0);
    }

    // 窄窗口：画廊少几列、自己换行，卡片名和设置行都不越界。
    await page.setViewportSize({ width: 900, height: 800 });
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      await expectNoOverflow(page.getByTestId("settings"));
    }
  } finally {
    await launched.close();
  }
});
