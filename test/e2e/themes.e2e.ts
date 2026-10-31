// 配色主题（spec §2.1、§4.19）：设置 → 通用 → 外观的主题画廊、背景图 / 毛玻璃设置行、命令面板的"选择主题…"。
// 主题的颜色只从 CSS 里读（tokens.css 的 light / dark、themes.css 的其余），不在测试里另抄一份。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { themeNames, themes, type ThemeName } from "../../src/shared/themes.ts";
import { expectNoOverflow, launchApp, setLocaleTheme, setTheme } from "./launch.ts";

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

/** 主进程每次 setTitleBarOverlay 的时刻和符号色（底色在毛玻璃时是透明，不看它）。 */
async function spyOverlay(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error("没有主窗口");
    const g = globalThis as unknown as { overlayCalls: { t: number; symbol: string }[] };
    g.overlayCalls = [];
    const original = window.setTitleBarOverlay.bind(window);
    window.setTitleBarOverlay = (options) => {
      g.overlayCalls.push({ t: Date.now(), symbol: options.symbolColor ?? "" });
      original(options);
    };
  });
}

async function overlayCalls(app: ElectronApplication): Promise<{ t: number; symbol: string }[]> {
  return app.evaluate(() => (globalThis as unknown as { overlayCalls: { t: number; symbol: string }[] }).overlayCalls);
}

async function lastSymbol(app: ElectronApplication): Promise<string | undefined> {
  return (await overlayCalls(app)).at(-1)?.symbol;
}

/** 符号色上叠一层该主题的 --bg-scrim（遮罩弹窗开着时三键该有的颜色，spec §2.1 的表）。 */
function dimmedSymbol(theme: ThemeName): string {
  const { text, scrim } = themes[theme];
  const match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(scrim);
  if (match === null) throw new Error(`${theme} 的 scrim 不是 rgba()`);
  const [r, g, b, alpha] = match.slice(1).map(Number) as [number, number, number, number];
  const over = [r, g, b];
  const channels = [1, 3, 5].map((at) => Number.parseInt(text.slice(at, at + 2), 16));
  const mixed = channels.map((c, i) => Math.round(c + ((over[i] ?? 0) - c) * alpha));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

test("系统三键跟着网页换主题：网页换之前不先变，和网页一起淡入；遮罩弹窗开着时换成新主题变暗的颜色；设置里减少动效时命令面板的变暗不渐变", async () => {
  test.skip(process.platform === "darwin", "mac 没有 titleBarOverlay，三键是系统的红黄绿");
  const launched = await launchApp();
  try {
    const { app, page } = launched;
    await expect(page.getByTestId("app-root")).toBeVisible();
    await setLocaleTheme(page, "zh-CN", "light");
    await spyOverlay(app);
    // 换成浅色时三键的淡入可能比网页晚收尾几毫秒：等它停在浅色，再从空记录开始量。
    await expect.poll(async () => (await lastSymbol(app)) ?? themes.light.text).toBe(themes.light.text);
    await app.evaluate(() => {
      (globalThis as unknown as { overlayCalls: unknown[] }).overlayCalls.length = 0;
    });
    // 网页 <html data-theme> 第一次变化的时刻。
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        themeChangedAt: number | null;
        document: { documentElement: object };
        MutationObserver: new (callback: () => void) => { observe(target: object, options: object): void };
      };
      g.themeChangedAt = null;
      new g.MutationObserver(() => (g.themeChangedAt ??= Date.now())).observe(g.document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    });
    await setTheme(page, "dracula");
    await expect.poll(() => lastSymbol(app)).toBe(themes.dracula.text);
    const changedAt = await page.evaluate(() => (globalThis as unknown as { themeChangedAt: number }).themeChangedAt);
    const calls = await overlayCalls(app);
    // 以前主进程一收到设置就直接换色，比网页早几十毫秒。
    expect(calls.filter((call) => call.t < changedAt).every((call) => call.symbol === themes.light.text)).toBe(true);
    // 淡入：中间有既不是旧色也不是新色的帧。
    expect(calls.some((call) => call.symbol !== themes.light.text && call.symbol !== themes.dracula.text)).toBe(true);

    // 遮罩弹窗开着时换主题：落在新主题变暗的颜色；关掉后恢复成新主题的颜色。
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect.poll(() => lastSymbol(app)).toBe(dimmedSymbol("dracula"));
    await setTheme(page, "catppuccin-mocha");
    await expect.poll(() => lastSymbol(app)).toBe(dimmedSymbol("catppuccin-mocha"));
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toBeHidden();
    await expect.poll(() => lastSymbol(app)).toBe(themes["catppuccin-mocha"].text);

    // 设置里的"减少动效"：命令面板的遮罩不淡入淡出，三键也直接换，没有中间色（以前主进程只看系统的"减少动画"）。
    await page.evaluate(() => globalThis.studio.setReduceMotion(true));
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await app.evaluate(() => {
      (globalThis as unknown as { overlayCalls: unknown[] }).overlayCalls.length = 0;
    });
    const ends = new Set<string>([themes["catppuccin-mocha"].text, dimmedSymbol("catppuccin-mocha")]);
    await page.keyboard.press("Control+k");
    await expect.poll(() => lastSymbol(app)).toBe(dimmedSymbol("catppuccin-mocha"));
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toBeHidden();
    await expect.poll(() => lastSymbol(app)).toBe(themes["catppuccin-mocha"].text);
    expect((await overlayCalls(app)).filter((call) => !ends.has(call.symbol))).toEqual([]);
  } finally {
    await launched.close();
  }
});
