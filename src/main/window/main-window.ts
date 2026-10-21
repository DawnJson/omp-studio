// 主窗口：安全配置（AGENTS.md "Electron 安全"）、"当前主窗口"引用、窗口状态记忆和主题同步。
import { app, BrowserWindow, nativeTheme, shell, systemPreferences } from "electron";
import path from "node:path";
import { appOrigin } from "./app-protocol.ts";
import { blockZoom } from "./security.ts";
import { restoredBounds, trackWindowState } from "./window-state.ts";

/**
 * 顶栏（通栏，高 40）的底色和系统三键符号色，取自 docs/design/spec.md §2.1；主题切换时用 win.setTitleBarOverlay 同步。
 * dimmed：有遮罩弹窗时，系统三键要和网页里盖了 --bg-scrim 的顶栏同色。三键不是网页画的，遮罩盖不到，
 * 所以这里给出"顶栏色上叠一层 --bg-scrim"混合后的实色（浅色 rgba(17,24,22,.32)，深色 rgba(4,6,5,.56)）。
 */
const titleBarHeight = 40;
function titleBarColors(dark: boolean, dimmed = false): { color: string; symbolColor: string } {
  if (dimmed) return dark ? { color: "#08070A", symbolColor: "#69676B" } : { color: "#A8A7AB", symbolColor: "#131118" };
  return dark ? { color: "#0C0B0E", symbolColor: "#E8E6EC" } : { color: "#EEEDF0", symbolColor: "#131118" };
}

let titleBarDimmed = false;

type Rgb = readonly [number, number, number];
type OverlayColors = { color: Rgb; symbolColor: Rgb };

function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function formatHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function overlayColors(dimmed: boolean): OverlayColors {
  const { color, symbolColor } = titleBarColors(nativeTheme.shouldUseDarkColors, dimmed);
  return { color: parseHex(color), symbolColor: parseHex(symbolColor) };
}

function applyOverlay(window: BrowserWindow, colors: OverlayColors): void {
  window.setTitleBarOverlay({
    color: formatHex(colors.color),
    symbolColor: formatHex(colors.symbolColor),
    height: titleBarHeight,
  });
}

/**
 * 三键颜色的渐变要和网页里遮罩的淡入淡出同一时长、同一曲线（tokens.css）。遮罩是在顶栏色上叠 --bg-scrim，按不透明度渐变，
 * 所以颜色在两端之间线性插值即可吻合。
 * - 变暗 = 遮罩淡入：--dur-fade（140ms，系统开了"减少动画"时 100ms）+ --ease-out cubic-bezier(0.22, 1, 0.36, 1)。
 * - 恢复 = 遮罩淡出（motion.css 的 data-closing="fade"）：--dur-fast-exit（84ms，减少动画时 0）+ --ease-in cubic-bezier(0.64, 0, 0.78, 0)。
 */
const dimMs = 140;
const dimReducedMs = 100;
const restoreMs = 84;
const easeOut = [0.22, 1, 0.36, 1] as const;
const easeIn = [0.64, 0, 0.78, 0] as const;
const frameMs = 16;

/** CSS cubic-bezier(x1, y1, x2, y2)：给定时间进度 x 求曲线值（牛顿迭代，退化时二分）。 */
function cubicBezier([x1, y1, x2, y2]: readonly [number, number, number, number], x: number): number {
  const at = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;
  let low = 0;
  let high = 1;
  let s = x;
  for (let i = 0; i < 24; i++) {
    const diff = at(x1, x2, s) - x;
    if (Math.abs(diff) < 1e-5) break;
    if (diff > 0) high = s;
    else low = s;
    s = (low + high) / 2;
  }
  return at(y1, y2, s);
}

let shown: OverlayColors | null = null;
let fadeTimer: NodeJS.Timeout | undefined;

function mix(from: Rgb, to: Rgb, progress: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * progress,
    from[1] + (to[1] - from[1]) * progress,
    from[2] + (to[2] - from[2]) * progress,
  ];
}

/**
 * 把三键从当前显示的颜色渐变到目标色；进行中的渐变被取消，从当前插值位置接着走。
 * animate=false（主题切换）立即换色。
 */
function fadeTitleBar(window: BrowserWindow, animate: boolean): void {
  clearInterval(fadeTimer);
  const target = overlayColors(titleBarDimmed);
  const reduced = systemPreferences.getAnimationSettings().prefersReducedMotion;
  const duration = titleBarDimmed ? (reduced ? dimReducedMs : dimMs) : reduced ? 0 : restoreMs;
  if (!animate || duration === 0 || window.isMinimized() || !window.isVisible()) {
    shown = target;
    applyOverlay(window, target);
    return;
  }
  // 窗口创建时的 titleBarOverlay 是未变暗的颜色，第一次渐变从它开始。
  const from = shown ?? overlayColors(false);
  const curve = titleBarDimmed ? easeOut : easeIn;
  const start = Date.now();
  fadeTimer = setInterval(() => {
    const progress = Math.min(1, (Date.now() - start) / duration);
    const eased = cubicBezier(curve, progress);
    shown =
      progress === 1
        ? target
        : {
            color: mix(from.color, target.color, eased),
            symbolColor: mix(from.symbolColor, target.symbolColor, eased),
          };
    if (!window.isDestroyed()) applyOverlay(window, shown);
    if (progress === 1 || window.isDestroyed()) clearInterval(fadeTimer);
  }, frameMs);
}

/** 渲染进程报告有没有遮罩弹窗开着；系统三键跟着遮罩一起渐变变暗/恢复。 */
export function setTitleBarDimmed(dimmed: boolean): void {
  if (titleBarDimmed === dimmed) return;
  titleBarDimmed = dimmed;
  const window = getMainWindow();
  if (window) fadeTitleBar(window, true);
}

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** 应用自己的页面地址：开发（未打包）时可由 ELECTRON_RENDERER_URL 指向 Vite 开发服务器；打包后只有 app://studio/。 */
function rendererEntryUrl(): string {
  const dev = app.isPackaged ? undefined : process.env["ELECTRON_RENDERER_URL"];
  return dev ?? `${appOrigin}/index.html`;
}

/** url 是不是应用自己的页面：只认入口页面这一个地址（开发服务器时认它的源）。 */
export function isAppUrl(url: string): boolean {
  const entry = new URL(rendererEntryUrl());
  const target = new URL(url);
  if (entry.protocol === "app:")
    return target.protocol === "app:" && target.host === entry.host && target.pathname === entry.pathname;
  return target.origin === entry.origin;
}

/** 窗口和任务栏图标（scripts/make-icons.ts 生成）：打包后在 resources 目录（extraResources），开发和 e2e 时在仓库的 resources/。 */
function windowIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(app.getAppPath(), "resources", "icon.ico");
}

export function createMainWindow(): BrowserWindow {
  const restored = restoredBounds();
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    ...restored.bounds,
    minWidth: 800,
    minHeight: 560,
    show: false,
    icon: windowIconPath(),
    // 照 Claude 桌面版：自绘通栏顶栏，系统三键由 titleBarOverlay 绘制（spec §3.1）。
    titleBarStyle: "hidden",
    titleBarOverlay: { ...titleBarColors(nativeTheme.shouldUseDarkColors), height: titleBarHeight },
    backgroundColor: titleBarColors(nativeTheme.shouldUseDarkColors).color,
    webPreferences: {
      preload: path.join(import.meta.dirname, "..", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
    },
  });
  // 开发和 e2e 跑的是 node_modules 里没改过图标的 electron.exe，任务栏按钮用 exe 自带的 Electron 图标，不认上面的 icon。
  // 给任务栏按钮单独指定图标（实测有效）；appId 和安装版不同，测试窗口不会并进装好的 omp-studio 的任务栏按钮。
  if (!app.isPackaged && process.platform === "win32")
    window.setAppDetails({ appId: "dev.omp-studio.app.dev", appIconPath: windowIconPath() });

  // 窗口内禁止导航到外部地址，也禁止新开窗口；http/https 链接交给系统浏览器。
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.once("ready-to-show", () => window.show());
  // 主题切换（设置或系统）时，系统三键的底色和符号色跟着顶栏走。
  const onThemeUpdated = () => fadeTitleBar(window, false);
  nativeTheme.on("updated", onThemeUpdated);
  window.once("closed", () => nativeTheme.off("updated", onThemeUpdated));
  // 渲染进程重载时弹窗都没了，不会再报"关闭"：先恢复。
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) setTitleBarDimmed(false);
  });
  blockZoom(window.webContents);
  trackWindowState(window);
  if (restored.maximized) window.maximize();
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;

  void window.loadURL(rendererEntryUrl());
  return window;
}
