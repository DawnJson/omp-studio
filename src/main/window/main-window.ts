// 主窗口：安全配置（AGENTS.md "Electron 安全"）、"当前主窗口"引用、窗口状态记忆和主题同步。
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import path from "node:path";
import { appOrigin } from "./app-protocol.ts";
import { blockZoom } from "./security.ts";
import { restoredBounds, trackWindowState } from "./window-state.ts";

/**
 * 顶栏（通栏，高 40）的底色和系统三键符号色，取自 docs/design/spec.md §2.1；主题切换时用 win.setTitleBarOverlay 同步。
 * dimmed：有遮罩弹窗时，系统三键要和网页里盖了 --bg-scrim 的顶栏同色。三键不是网页画的，遮罩盖不到，
 * 所以这里给出"顶栏色上叠一层 --bg-scrim"混合后的实色（浅色 rgba(17,24,22,.32)，深色 rgba(4,6,5,.56)）。
 */
export const titleBarHeight = 40;
export function titleBarColors(dark: boolean, dimmed = false): { color: string; symbolColor: string } {
  if (dimmed) return dark ? { color: "#070A09", symbolColor: "#676B6A" } : { color: "#A7ABAA", symbolColor: "#111816" };
  return dark ? { color: "#0B0E0D", symbolColor: "#E6ECEA" } : { color: "#EDF0EF", symbolColor: "#111816" };
}

let titleBarDimmed = false;

function syncTitleBar(window: BrowserWindow): void {
  window.setTitleBarOverlay({
    ...titleBarColors(nativeTheme.shouldUseDarkColors, titleBarDimmed),
    height: titleBarHeight,
  });
}

/** 渲染进程报告有没有遮罩弹窗开着；系统三键跟着变暗/恢复。 */
export function setTitleBarDimmed(dimmed: boolean): void {
  if (titleBarDimmed === dimmed) return;
  titleBarDimmed = dimmed;
  const window = getMainWindow();
  if (window) syncTitleBar(window);
}

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** 应用自己的页面地址：开发（未打包）时可由 ELECTRON_RENDERER_URL 指向 Vite 开发服务器；打包后只有 app://studio/。 */
export function rendererEntryUrl(): string {
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

export function createMainWindow(): BrowserWindow {
  const restored = restoredBounds();
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    ...restored.bounds,
    minWidth: 800,
    minHeight: 560,
    show: false,
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
  const onThemeUpdated = () => syncTitleBar(window);
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
