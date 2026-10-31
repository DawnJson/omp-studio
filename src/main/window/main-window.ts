// 主窗口：安全配置（docs/architecture/security.md「窗口和页面」）、"当前主窗口"引用、窗口状态记忆和主题同步。
import { app, BrowserWindow, nativeTheme, screen, shell, systemPreferences } from "electron";
import { release } from "node:os";
import path from "node:path";
import { defaultFontSize, type TitleBarFade } from "../../shared/ipc.ts";
import { resolveTheme, themes, type ThemePreference, type ThemeSpec } from "../../shared/themes.ts";
import { appOrigin } from "./app-protocol.ts";
import { loadWin32 } from "../platform/win32/ffi.ts";
import { getSettings, offSettingsChanged, onSettingsChanged } from "../settings/settings-store.ts";
import { blockZoom } from "./security.ts";
import { registerShutdownHook } from "./shutdown.ts";
import { attachTaskbarWindow } from "./taskbar-progress.ts";
import { restoredBounds, trackWindowState } from "./window-state.ts";
import { emitEvent } from "../ipc/events.ts";

/**
 * 顶栏（通栏，高 40）的底色和系统三键符号色 = 网页正在显示的主题的 --bg-sidebar / --text（登记在 src/shared/themes.ts）。
 * 三键不是网页画的，主进程用 win.setTitleBarOverlay 让它跟着网页走（docs/architecture/themes.md「系统三键」）：
 * - 主题跟网页的 <html data-theme> 走，不跟设置走：设置改了以后网页要过几十毫秒才换、换时还要整窗交叉淡入，
 *   三键跟设置就会先跳色（2026-10-31 实测：改设置后约 10ms 三键已换完，网页 26–118ms 后才开始淡入）。
 *   渲染进程在淡入开始时报告（setTitleBarTheme），三键用同样的时长和曲线一起淡入。
 * - 有遮罩弹窗时（setTitleBarDimmed），三键要和网页里盖了 --bg-scrim 的顶栏同色。遮罩盖不到三键，
 *   所以给出"顶栏色上叠一层 --bg-scrim"混合后的实色。
 */
const titleBarHeight = 40;

/** mac 没有 setTitleBarOverlay（Electron 类型声明标 @platform win32,linux），三键颜色相关逻辑全部跳过。 */
const isMac = process.platform === "darwin";
/**
 * e2e 在后台跑（`test/e2e/launch.ts` 设 `STUDIO_E2E_BACKGROUND=1`）：窗口不进任务栏，显示时不抢焦点，Windows 上再 cloak 掉
 * （系统不画、点不到，页面照常绘制），跑测试时不弹到用户面前、不打断用户打字。
 */
export const e2eBackground = process.env["STUDIO_E2E_BACKGROUND"] === "1";

/**
 * Windows 11 毛玻璃（设置 glass，docs/architecture/themes.md「毛玻璃」）：窗口用系统的 Acrylic（backgroundMaterial），
 * 窗口和网页底色透明，顶栏、侧栏在网页里画半透明的侧栏色，主区面板仍是实底。
 * DWMWA_SYSTEMBACKDROP_TYPE 从 Windows 11 22H2（build 22621）起才有，Electron 在更早的系统上直接忽略；mac 的 vibrancy 不做。
 */
export const glassSupported = process.platform === "win32" && Number(release().split(".")[2]) >= 22621;

function glassOn(): boolean {
  return glassSupported && getSettings().glass;
}

/** 窗口底色：平时是网页当前主题的顶栏色（首帧前、拖大窗口时露出的那一块和顶栏一致）；毛玻璃时透明，否则盖住 Acrylic。 */
function windowBackground(): string {
  return glassOn() ? "#00000000" : pageThemeSpec().sidebar;
}

/**
 * 三键区底色。毛玻璃时全透明：三键画在网页上面，透出的就是网页顶栏那层半透明侧栏色，遮罩弹窗时网页的遮罩也盖得到
 * （符号色照常随遮罩渐变）。不用"带 alpha 的侧栏色"：Electron 先给整个三键区铺一次底色、每个按钮再铺一次，
 * 叠出来比网页顶栏深一截，按钮之间还有缝（Electron 44.10.0 实测）。
 */
function overlayBackground(color: Rgb): string {
  return glassOn() ? "#00000000" : formatHex(color);
}

function showWindow(window: BrowserWindow): void {
  if (e2eBackground) window.showInactive();
  else window.show();
}

type Rgb = readonly [number, number, number];
type OverlayColors = { color: Rgb; symbolColor: Rgb };
type Curve = readonly [number, number, number, number];

function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function formatHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(from: Rgb, to: Rgb, progress: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * progress,
    from[1] + (to[1] - from[1]) * progress,
    from[2] + (to[2] - from[2]) * progress,
  ];
}

function mixColors(from: OverlayColors, to: OverlayColors, progress: number): OverlayColors {
  return { color: mix(from.color, to.color, progress), symbolColor: mix(from.symbolColor, to.symbolColor, progress) };
}

/** 网页 <html data-theme> 现在的值（渲染进程报告；没有 data-theme = system）。窗口创建时取设置里的，页面第一次套用的也是它。 */
let pageTheme: ThemePreference = "system";

/** 网页正在显示的主题：跟随系统时和网页的 prefers-color-scheme 一样，按 nativeTheme 的深浅取 light / dark。 */
function pageThemeSpec(): ThemeSpec {
  return themes[resolveTheme(pageTheme, nativeTheme.shouldUseDarkColors)];
}

/** dim = 遮罩的不透明度（0 没有遮罩，1 全显）：顶栏色、符号色上叠 dim 倍的 --bg-scrim。 */
function overlayColors(theme: ThemeSpec, dim: number): OverlayColors {
  const color = parseHex(theme.sidebar);
  const symbolColor = parseHex(theme.text);
  const scrim = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(theme.scrim);
  if (scrim === null) throw new Error(`theme scrim is not rgba(): ${theme.scrim}`);
  const [, r, g, b, alpha] = scrim.map(Number);
  const over: Rgb = [r ?? 0, g ?? 0, b ?? 0];
  const amount = (alpha ?? 0) * dim;
  return { color: mix(color, over, amount), symbolColor: mix(symbolColor, over, amount) };
}

/** 页面缩放后顶栏（--titlebar-h = 40 CSS px）占 40 × 缩放 个窗口像素，系统三键区的高度要一起放大，否则和顶栏对不齐。 */
function applyOverlay(window: BrowserWindow, colors: OverlayColors): void {
  window.setTitleBarOverlay({
    color: overlayBackground(colors.color),
    symbolColor: formatHex(colors.symbolColor),
    height: Math.round((titleBarHeight * getSettings().fontSize) / defaultFontSize),
  });
}

/** 把设置里的字号落到页面缩放（字号 / 15，15 是设计稿正文字号），并让三键区高度跟上。幂等：每次页面加载完、缩放被改动、设置变化时都调用。 */
function applyFontSize(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const factor = getSettings().fontSize / defaultFontSize;
  if (window.webContents.getZoomFactor() !== factor) window.webContents.setZoomFactor(factor);
  if (!isMac) applyOverlay(window, currentOverlay(Date.now()));
}

/**
 * 三键的渐变和网页里对应的那段动画同一时长、同一曲线（tokens.css）。遮罩是在顶栏色上叠 --bg-scrim、按不透明度渐变，
 * 交叉淡入是新旧两张画面按不透明度混合，所以颜色在两端之间按曲线值线性插值即可吻合。
 * reducedMs：减少动效（reducedMotion()）时的时长。
 */
type Fade = { ms: number; reducedMs: number; curve: Curve };
const easeOut = [0.22, 1, 0.36, 1] as const;
const easeIn = [0.64, 0, 0.78, 0] as const;
const easeInOut = [0.65, 0, 0.35, 1] as const;
const dimFades: Record<TitleBarFade, { dim: Fade; restore: Fade }> = {
  // 遮罩淡入：--dur-fade（140ms，减少动效 100ms）+ --ease-out；
  // 淡出（motion.css 的 data-closing="fade"）：--dur-fast-exit（84ms，减少动效 0）+ --ease-in。
  scrim: { dim: { ms: 140, reducedMs: 100, curve: easeOut }, restore: { ms: 84, reducedMs: 0, curve: easeIn } },
  // 命令面板（palette.css）：淡入 --dur-fast（140ms，减少动效 0）+ --ease-out，淡出同上。
  palette: { dim: { ms: 140, reducedMs: 0, curve: easeOut }, restore: { ms: 84, reducedMs: 0, curve: easeIn } },
  // 放大看图的整窗交叉淡入（tsp.css 的 :root[data-tsp-zoom-vt]），开和关都是
  // max(--dur-base, --dur-fade)（200ms，减少动效 100ms）+ --ease-out。
  zoom: { dim: { ms: 200, reducedMs: 100, curve: easeOut }, restore: { ms: 200, reducedMs: 100, curve: easeOut } },
};
/** 切换主题的整窗交叉淡入（app.css 的 ::view-transition-*(root)）：--dur-slow（320ms，减少动效时 --dur-fade 100ms）+ --ease-in-out。 */
const themeFade: Fade = { ms: 320, reducedMs: 100, curve: easeInOut };
/**
 * 逐帧定时器的间隔。Windows 的系统时钟约 15.6ms 一跳：间隔写 16 实际每 31ms 才跑一次（libuv 醒在第一跳时还差不到 1ms，
 * 要再等一跳），淡入淡出只有五六帧。写 10 就每跳都跑，约 64 帧/秒（2026-10-26 实测）。
 */
const frameMs = 10;

/** 减少动效：系统的"减少动画"或设置里的开关，和渲染进程的 data-motion / prefers-reduced-motion 同一判断。 */
function reducedMotion(): boolean {
  return systemPreferences.getAnimationSettings().prefersReducedMotion || getSettings().reduceMotion;
}

/** CSS cubic-bezier(x1, y1, x2, y2)：给定时间进度 x 求曲线值（牛顿迭代，退化时二分）。 */
function cubicBezier([x1, y1, x2, y2]: Curve, x: number): number {
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

/** 进行中的一段渐变：从 start 起 duration 毫秒，按 curve 走。 */
type Tween = { start: number; duration: number; curve: Curve };

/** 走过的比例（按曲线算），1 = 走完。 */
function eased(tween: Tween, now: number): number {
  const progress = Math.min(1, (now - tween.start) / tween.duration);
  return progress === 1 ? 1 : cubicBezier(tween.curve, progress);
}

/** 遮罩最终要到的不透明度：有遮罩弹窗开着为 1。 */
let dimTarget: 0 | 1 = 0;
/** 遮罩不透明度的渐变，from 是开始时的不透明度；被新的一次打断时从当前位置接着走。 */
let dimTween: (Tween & { from: number }) | null = null;
/**
 * 主题的交叉淡入，照网页的 View Transition：from 是换主题那一刻三键的颜色（旧画面的快照，定住不动），
 * 淡入的一层是实时颜色（遮罩照常变暗、恢复）。
 */
let themeTween: (Tween & { from: OverlayColors }) | null = null;
let frameTimer: NodeJS.Timeout | undefined;

function dimLevel(now: number): number {
  if (dimTween === null) return dimTarget;
  const progress = eased(dimTween, now);
  if (progress < 1) return dimTween.from + (dimTarget - dimTween.from) * progress;
  dimTween = null;
  return dimTarget;
}

/** 此刻三键该是的颜色；走完的渐变顺手清掉。 */
function currentOverlay(now: number): OverlayColors {
  const live = overlayColors(pageThemeSpec(), dimLevel(now));
  if (themeTween === null) return live;
  const progress = eased(themeTween, now);
  if (progress === 1) {
    themeTween = null;
    return live;
  }
  return mixColors(themeTween.from, live, progress);
}

/** 画一次三键；还有渐变没走完就逐帧接着画，走完停。窗口最小化或隐藏时看不见，渐变直接跳到终点。 */
function paintTitleBar(window: BrowserWindow): void {
  if (isMac || window.isDestroyed()) return;
  clearInterval(frameTimer);
  if (window.isMinimized() || !window.isVisible()) {
    dimTween = null;
    themeTween = null;
  }
  applyOverlay(window, currentOverlay(Date.now()));
  if (dimTween === null && themeTween === null) return;
  frameTimer = setInterval(() => {
    if (window.isDestroyed()) {
      clearInterval(frameTimer);
      return;
    }
    applyOverlay(window, currentOverlay(Date.now()));
    if (dimTween === null && themeTween === null) clearInterval(frameTimer);
  }, frameMs);
}

/** 渲染进程报告有没有遮罩弹窗开着；Windows 的系统三键跟着遮罩一起渐变变暗/恢复（mac 无此三键，空操作）。 */
export function setTitleBarDimmed(dimmed: boolean, fade: TitleBarFade): void {
  if (isMac) return;
  const target = dimmed ? 1 : 0;
  if (dimTarget === target) return;
  const now = Date.now();
  const from = dimLevel(now);
  dimTarget = target;
  const timing = dimFades[fade][dimmed ? "dim" : "restore"];
  const duration = reducedMotion() ? timing.reducedMs : timing.ms;
  dimTween = duration === 0 ? null : { from, start: now, duration, curve: timing.curve };
  const window = getMainWindow();
  if (window) paintTitleBar(window);
}

/**
 * 渲染进程报告网页的 data-theme 换了：窗口底色立即换，三键 crossfade 时从此刻的颜色一起淡入（报告在网页淡入开始时发出），
 * 否则直接换。
 */
export function setTitleBarTheme(theme: ThemePreference, crossfade: boolean): void {
  if (theme === pageTheme && !crossfade) return;
  const now = Date.now();
  const from = overlayColors(pageThemeSpec(), dimLevel(now));
  pageTheme = theme;
  const window = getMainWindow();
  if (window === null) return;
  window.setBackgroundColor(windowBackground());
  const duration = reducedMotion() ? themeFade.reducedMs : themeFade.ms;
  themeTween = crossfade ? { from, start: now, duration, curve: themeFade.curve } : null;
  paintTitleBar(window);
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
  const reduced = reducedMotion();
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
    showWindow(window);
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
  pageTheme = getSettings().theme;
  const initialColors = overlayColors(pageThemeSpec(), 0);
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    ...restored.bounds,
    ...(e2eBackground ? { skipTaskbar: true } : {}),
    minWidth: 800,
    minHeight: 560,
    show: false,
    ...(isMac ? {} : { icon: windowIconPath() }),
    // 照 Claude 桌面版：自绘通栏顶栏（spec §3.1）。Windows 的系统三键由 titleBarOverlay 绘制；
    // mac 没有 titleBarOverlay（Electron 只在 win32/linux 提供），三键是系统的红黄绿，用 trafficLightPosition 摆位。
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition }
      : {
          titleBarOverlay: {
            color: overlayBackground(initialColors.color),
            symbolColor: formatHex(initialColors.symbolColor),
            height: titleBarHeight,
          },
        }),
    backgroundColor: windowBackground(),
    // 创建时就带上材质，第一帧就是毛玻璃；运行时开关见下面 onSettings（setBackgroundMaterial 不用重建窗口，实测）。
    ...(glassOn() ? { backgroundMaterial: "acrylic" as const } : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "..", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
    },
  });
  // 不挪到屏幕外：屏幕外的窗口内容尺寸算错（多出边框的 16×8，2026-10-28 实测），量布局的用例会错。
  if (e2eBackground && process.platform === "win32")
    loadWin32().dwmapi.cloakWindow(Number(window.getNativeWindowHandle().readBigUInt64LE()));
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
    if (restored.maximized && !e2eBackground) window.maximize();
    showWindow(window);
  });
  // 跟随系统时，系统深浅一变网页的 prefers-color-scheme 立刻跟着变（不淡入），窗口底色和三键也立刻换。
  // 设置里换主题不在这里：等渲染进程换完 data-theme 报告（setTitleBarTheme）。
  const onNativeTheme = () => {
    if (pageTheme !== "system") return;
    window.setBackgroundColor(windowBackground());
    paintTitleBar(window);
  };
  nativeTheme.on("updated", onNativeTheme);
  window.once("closed", () => nativeTheme.off("updated", onNativeTheme));
  // 渲染进程重载时弹窗都没了，不会再报"关闭"：先恢复。
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) setTitleBarDimmed(false, "scrim");
  });
  applyFontSize(window);
  // 字号 = 整页缩放：重载/导航后 Chromium 会回到按源记的缩放，滚轮缩放（zoom-changed）也可能改动，统一拉回设置里的档位。
  // 页面没处理的 Ctrl+滚轮转给渲染进程：文件预览的网页在沙箱 iframe 里，滚轮事件到不了应用页面，只能靠这个缩放。
  // 事件不带位置，父页面也看不到指针在 iframe 里（:hover、pointer 事件都没有）：取光标位置换成页面的 CSS 像素一起发过去。
  window.webContents.on("did-finish-load", () => applyFontSize(window));
  window.webContents.on("zoom-changed", (_event, direction) => {
    applyFontSize(window);
    const cursor = screen.getCursorScreenPoint();
    const content = window.getContentBounds();
    const zoom = window.webContents.getZoomFactor();
    emitEvent("zoomGesture", { direction, x: (cursor.x - content.x) / zoom, y: (cursor.y - content.y) / zoom });
  });
  let shownGlass = glassOn();
  const onSettings = () => {
    const glass = glassOn();
    if (glass !== shownGlass) {
      shownGlass = glass;
      // "none" 时 Electron 把底色重置成白色，紧接着换回顶栏色；三键区底色由下面的 applyFontSize 重铺。
      window.setBackgroundMaterial(glass ? "acrylic" : "none");
      window.setBackgroundColor(windowBackground());
    }
    applyFontSize(window);
  };
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
