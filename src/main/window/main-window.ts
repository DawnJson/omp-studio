// 主窗口：安全配置（AGENTS.md "Electron 安全"）和"当前主窗口"引用。窗口外观、状态记忆、CSP、权限请求由外壳切片补全。
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, nativeTheme, shell } from "electron";

/** 顶栏（通栏，高 40）的底色和系统三键符号色，取自 docs/design/spec.md §2.1；主题切换时用 win.setTitleBarOverlay(titleBarColors(dark)) 同步。 */
export const titleBarHeight = 40;
export function titleBarColors(dark: boolean): { color: string; symbolColor: string } {
  return dark ? { color: "#0E0F12", symbolColor: "#ECEDEF" } : { color: "#F3F3F1", symbolColor: "#16171A" };
}

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** 应用自己的页面地址：开发时是 Vite 开发服务器，打包后是 out/renderer/index.html。 */
export function rendererEntryUrl(): string {
  return process.env["ELECTRON_RENDERER_URL"] ?? pathToFileURL(path.join(import.meta.dirname, "..", "renderer", "index.html")).href;
}

/** url 是不是应用自己的页面：打包后只认 index.html 这一个文件，开发时认 Vite 开发服务器的源。 */
export function isAppUrl(url: string): boolean {
  const entry = new URL(rendererEntryUrl());
  const target = new URL(url);
  if (entry.protocol === "file:") return target.protocol === "file:" && target.pathname === entry.pathname;
  return target.origin === entry.origin;
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
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
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;

  void window.loadURL(rendererEntryUrl());
  return window;
}
