// TspFeed 的 Electron 接线：批次经 emitEvent 推给主窗口；跟着主窗口的显示 / 隐藏 / 最小化 / 还原开关推送，
// 窗口换了（新的渲染进程）或页面真的换了（重载）就清空登记（渲染进程的镜像都没了）。
import type { BrowserWindow } from "electron";
import { emitEvent } from "../ipc/events.ts";
import { getMainWindow } from "../window/main-window.ts";
import { TspFeed } from "./tsp-feed.ts";

const feed = new TspFeed((batch) => emitEvent("tspBatch", batch));
let watched: BrowserWindow | null = null;

/** 推送的单例；第一次见到一个主窗口时接上它的事件。 */
export function tspFeed(): TspFeed {
  const window = getMainWindow();
  if (window !== null && window !== watched) {
    watched = window;
    feed.reset();
    const sync = (): void => feed.setHidden(!window.isVisible() || window.isMinimized());
    window.on("show", sync);
    window.on("hide", sync);
    window.on("minimize", sync);
    window.on("restore", sync);
    // 有的窗口管理器还原时不发 restore：聚焦、最大化 / 取消最大化时也重新看一次。
    window.on("focus", sync);
    window.on("maximize", sync);
    window.on("unmaximize", sync);
    // 只认已提交的主框架导航：did-start-navigation 在 main-window.ts 的 will-navigate 拦截之前就发，被拦下的导航（往非拖放区拖文件、点链接）
    // 页面根本没换，清了登记渲染进程却还以为在收批次，对话就停住了。did-navigate 只在主框架、只在真的换了文档时发（页内跳转是 did-navigate-in-page）。
    window.webContents.on("did-navigate", () => feed.reset());
    sync();
  }
  return feed;
}
