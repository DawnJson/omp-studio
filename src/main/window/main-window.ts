// 主窗口：安全配置（AGENTS.md "Electron 安全"）、"当前主窗口"引用、窗口状态记忆和主题同步。
import { app, BrowserWindow, nativeTheme, shell, systemPreferences } from "electron";
import path from "node:path";
import { defaultFontSize } from "../../shared/ipc.ts";
import { appOrigin } from "./app-protocol.ts";
import { getSettings, offSettingsChanged, onSettingsChanged } from "../settings/settings-store.ts";
import { blockZoom } from "./security.ts";
import { registerShutdownHook } from "./shutdown.ts";
import { attachTaskbarWindow } from "./taskbar-progress.ts";
import { restoredBounds, trackWindowState } from "./window-state.ts";

/**
 * 顶栏（通栏，高 40）的底色和系统三键符号色 = tokens.css 的 --bg-sidebar / --text；主题切换时用 win.setTitleBarOverlay 同步。
 * dimmed：有遮罩弹窗时，系统三键要和网页里盖了 --bg-scrim 的顶栏同色。三键不是网页画的，遮罩盖不到，
 * 所以这里给出"顶栏色上叠一层 --bg-scrim"混合后的实色（浅色 rgba(20,20,18,.32)，深色 rgba(5,5,4,.56)）。
 */
const titleBarHeight = 40;
function titleBarColors(dark: boolean, dimmed = false): { color: string; symbolColor: string } {
  if (dimmed) return dark ? { color: "#090908", symbolColor: "#6B6B69" } : { color: "#AAAAA7", symbolColor: "#151513" };
  return dark ? { color: "#0E0E0D", symbolColor: "#ECECE9" } : { color: "#F1F0ED", symbolColor: "#161614" };
}

let titleBarDimmed = false;

/** mac 没有 setTitleBarOverlay（Electron 类型声明标 @platform win32,linux），三键颜色相关逻辑全部跳过。 */
const isMac = process.platform === "darwin";

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

/** 页面缩放后顶栏（--titlebar-h = 40 CSS px）占 40 × 缩放 个窗口像素，系统三键区的高度要一起放大，否则和顶栏对不齐。 */
function applyOverlay(window: BrowserWindow, colors: OverlayColors): void {
  window.setTitleBarOverlay({
    color: formatHex(colors.color),
    symbolColor: formatHex(colors.symbolColor),
    height: Math.round((titleBarHeight * getSettings().fontSize) / defaultFontSize),
  });
}

/** 把设置里的字号落到页面缩放（字号 / 15，15 是设计稿正文字号），并让三键区高度跟上。幂等：每次页面加载完、缩放被改动、设置变化时都调用。 */
function applyFontSize(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const factor = getSettings().fontSize / defaultFontSize;
  if (window.webContents.getZoomFactor() !== factor) window.webContents.setZoomFactor(factor);
  if (!isMac) applyOverlay(window, shown ?? overlayColors(titleBarDimmed));
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
/**
 * 逐帧定时器的间隔。Windows 的系统时钟约 15.6ms 一跳：间隔写 16 实际每 31ms 才跑一次（libuv 醒在第一跳时还差不到 1ms，
 * 要再等一跳），淡入淡出只有五六帧。写 10 就每跳都跑，约 64 帧/秒（2026-10-26 实测）。
 */
const frameMs = 10;

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
  if (isMac) return;
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

/** 渲染进程报告有没有遮罩弹窗开着；Windows 的系统三键跟着遮罩一起渐变变暗/恢复（mac 无此三键，空操作）。 */
export function setTitleBarDimmed(dimmed: boolean): void {
  if (isMac) return;
  if (titleBarDimmed === dimmed) return;
  titleBarDimmed = dimmed;
  const window = getMainWindow();
  if (window) fadeTitleBar(window, true);
}

/**
 * 整个窗口的淡入淡出（spec §2.6「窗口出现 / 消失」）：启动、从托盘带回时淡入，× 隐藏、退出时淡出。
 * 用 setOpacity 逐帧改窗口的不透明度；系统自己的开关窗动画（DWM）作用在透明的窗口上看不见，不会叠两层。
 * 整个窗口的透明度比网页里的弹层显眼得多，用自己的时长和曲线，不套 tokens.css：
 * 出现 320ms + ease-out-cubic，消失 240ms + ease-in-out（一开始就开始变淡，不先停在不透明再一下切掉）。
 * 以前用 --dur-base（200ms）+ --ease-out 和 --dur-base-exit（120ms）+ --ease-in：淡入 80ms 就到 0.92，
 * 淡出前 70ms 几乎不动、最后 50ms 消失，看上去就是直接出现 / 消失（2026-10-26 实测时间线）。
 * 减少动效（系统或设置里的开关，和渲染进程的 data-motion 同一判断）时两者都是 --dur-fade 的 100ms，只剩透明度、不闪现。
 */
const windowEnterMs = 320;
const windowExitMs = 240;
const windowReducedMs = 100;
const windowEnterCurve = [0.33, 1, 0.68, 1] as const;
const windowExitCurve = [0.33, 0, 0.67, 1] as const;
let opacityTimer: NodeJS.Timeout | undefined;
/** 正在进行的淡入淡出被新的一次打断时，让等它的一方知道（false = 没走完，别再接着 hide）。 */
let settleOpacity: ((completed: boolean) => void) | undefined;

function fadeWindow(window: BrowserWindow, to: 0 | 1): Promise<boolean> {
  clearInterval(opacityTimer);
  settleOpacity?.(false);
  const reduced = systemPreferences.getAnimationSettings().prefersReducedMotion || getSettings().reduceMotion;
  const duration = reduced ? windowReducedMs : to === 1 ? windowEnterMs : windowExitMs;
  const from = window.getOpacity();
  const curve = to === 1 ? windowEnterCurve : windowExitCurve;
  const start = Date.now();
  return new Promise((resolve) => {
    settleOpacity = resolve;
    opacityTimer = setInterval(() => {
      if (window.isDestroyed()) {
        clearInterval(opacityTimer);
        settleOpacity = undefined;
        resolve(false);
        return;
      }
      const progress = Math.min(1, (Date.now() - start) / duration);
      window.setOpacity(progress === 1 ? to : from + (to - from) * cubicBezier(curve, progress));
      if (progress < 1) return;
      clearInterval(opacityTimer);
      settleOpacity = undefined;
      resolve(true);
    }, frameMs);
  });
}

/** 启动的窗口：ready-to-show 时已经透明着显示，等渲染进程第一帧画完再淡入；淡入过就清掉，之后重载页面不再触发。 */
let awaitingFirstFrame: BrowserWindow | null = null;
/** 启动的窗口第一次淡入完成后跑一次（index.ts 的预读）。 */
let onFirstReveal: (() => void) | null = null;

/** 启动的窗口第一次淡入完成后调用 callback 一次（不管是渲染进程第一帧触发的，还是先被第二个实例等带到前台的）。 */
export function afterFirstReveal(callback: () => void): void {
  onFirstReveal = callback;
}

/** 显示隐藏着的窗口并淡入（透明着显示的、淡出到一半的也淡入）；已经完全显示的不动。最小化的由调用方 restore，那是系统动画。 */
export function revealWindow(window: BrowserWindow): void {
  const first = awaitingFirstFrame === window;
  if (first) awaitingFirstFrame = null;
  if (!window.isVisible()) {
    window.setOpacity(0);
    window.show();
  }
  const faded = window.getOpacity() < 1 ? fadeWindow(window, 1) : Promise.resolve(true);
  if (!first) return;
  const callback = onFirstReveal;
  onFirstReveal = null;
  if (callback) void faded.then(callback);
}

/** 淡出后隐藏；隐藏后把不透明度还原，别的地方直接 show() 也不会是透明的。淡出途中被重新显示打断就不隐藏。 */
export async function concealWindow(window: BrowserWindow): Promise<void> {
  if (!window.isVisible()) return;
  if (!(await fadeWindow(window, 0))) return;
  window.hide();
  window.setOpacity(1);
}

/** 渲染进程第一帧（设置已读到、主题已套上）画完了（windowReady）：启动的窗口这时淡入。之前已被带到前台（第二个实例等）的不再动。 */
export function revealOnFirstFrame(): void {
  const window = awaitingFirstFrame;
  if (window === null || window.isDestroyed()) return;
  revealWindow(window);
}

// 退出时先淡出隐藏窗口，和关 omp 进程等其余收尾并行；没有可见窗口时立即完成。
registerShutdownHook(async () => {
  const window = getMainWindow();
  if (window) await concealWindow(window);
});

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

/**
 * 窗口和任务栏图标（scripts/make-icons.ts 生成）：打包后在 resources 目录（extraResources），开发和 e2e 时在仓库的 resources/。
 * Windows 用 icon.ico，Linux 用 icon.png（X11 的窗口图标；Wayland 下桌面环境按 .desktop 文件取图标，没装进菜单的 AppImage
 * 可能显示通用图标，推测，未实测）。
 * mac 不用：BrowserWindow.icon 被忽略，Dock 图标来自 app bundle。
 */
function windowIconPath(): string {
  const name = process.platform === "win32" ? "icon.ico" : "icon.png";
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(app.getAppPath(), "resources", name);
}

/**
 * mac 红黄绿三键位置（titleBarStyle "hidden" 时三键画在窗口左上角，位置由此指定）。未在 mac 上实测，数值是推算：
 * 三键直径约 12px，要在 40px 高的顶栏里垂直居中 → y = (40 - 12) / 2 = 14，实际取 13（系统按 y 为三键组的上边缘，
 * 圆点有 1px 阴影，略往上更像系统自带的视觉重心）；x = 14 与左侧内边距对齐。需要真机看一眼后微调。
 */
const trafficLightPosition = { x: 14, y: 13 } as const;

export function createMainWindow(): BrowserWindow {
  const restored = restoredBounds();
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    ...restored.bounds,
    minWidth: 800,
    minHeight: 560,
    show: false,
    ...(isMac ? {} : { icon: windowIconPath() }),
    // 照 Claude 桌面版：自绘通栏顶栏（spec §3.1）。Windows 的系统三键由 titleBarOverlay 绘制；
    // mac 没有 titleBarOverlay（Electron 只在 win32/linux 提供），三键是系统的红黄绿，用 trafficLightPosition 摆位。
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition }
      : { titleBarOverlay: { ...titleBarColors(nativeTheme.shouldUseDarkColors), height: titleBarHeight } }),
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

  // 启动：页面第一次绘制（ready-to-show）时先透明着显示，系统趁 React 还在等字体、设置时把窗口的绘制面准备好；
  // 渲染进程报告第一帧画完（windowReady -> revealOnFirstFrame）再淡入。等到那时才 show() 的话，显示后还要约 300ms 才有画面，
  // 淡入的是一块空底色（2026-10-26 实测）。最大化也留到这时：maximize() 会立刻显示窗口。
  awaitingFirstFrame = window;
  window.once("ready-to-show", () => {
    if (awaitingFirstFrame !== window) return;
    window.setOpacity(0);
    if (restored.maximized) window.maximize();
    window.show();
  });
  // 主题切换（设置或系统）时，系统三键的底色和符号色跟着顶栏走。
  const onThemeUpdated = () => fadeTitleBar(window, false);
  nativeTheme.on("updated", onThemeUpdated);
  window.once("closed", () => nativeTheme.off("updated", onThemeUpdated));
  // 渲染进程重载时弹窗都没了，不会再报"关闭"：先恢复。
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) setTitleBarDimmed(false);
  });
  applyFontSize(window);
  // 字号 = 整页缩放：重载/导航后 Chromium 会回到按源记的缩放，滚轮缩放（zoom-changed）也可能改动，统一拉回设置里的档位。
  window.webContents.on("did-finish-load", () => applyFontSize(window));
  window.webContents.on("zoom-changed", () => applyFontSize(window));
  const onSettings = () => applyFontSize(window);
  onSettingsChanged(onSettings);
  window.once("closed", () => offSettingsChanged(onSettings));
  blockZoom(window.webContents);
  trackWindowState(window);
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
  attachTaskbarWindow(window);

  void window.loadURL(rendererEntryUrl());
  return window;
}
