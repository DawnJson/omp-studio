// 托盘图标：应用常驻托盘，关窗口只隐藏（hide-on-close.ts）。左键显示并聚焦窗口；右键菜单见 tray-model.ts。
// 提示和菜单随任务状态刷新（runtime.ts 的 state 事件调用 refreshTray）；语言切换或鼠标移到图标上时也会重新生成，
// 内容没变就不动系统托盘。
import path from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";
import type { TaskState } from "../../shared/ipc.ts";
import { resolveLocale } from "../settings/settings-store.ts";
import { emitEvent } from "../ipc/events.ts";
import { showMainWindow } from "./show-window.ts";
import { trayCounts, trayMenuTemplate, trayTooltip, type TrayActions } from "./tray-model.ts";
import { t } from "../../shared/i18n/index.ts";

let tray: Tray | null = null;
let tasks: readonly TaskState[] = [];
let lastSignature = "";

/** 图标：打包后在 resources 目录（extraResources），开发和 e2e 时在仓库的 resources/。 */
function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "tray.png")
    : path.join(app.getAppPath(), "resources", "tray.png");
}

const actions: TrayActions = {
  open: () => {
    showMainWindow();
  },
  focusTask: (id) => {
    showMainWindow();
    emitEvent("focusTask", id);
  },
  quit: () => app.quit(),
};

function render(): void {
  if (!tray) return;
  const locale = resolveLocale();
  const tooltip = trayTooltip(locale, trayCounts(tasks));
  const template = trayMenuTemplate(locale, tasks, actions);
  const signature = JSON.stringify([tooltip, template.map(({ label, type, enabled }) => [label, type, enabled])]);
  if (signature === lastSignature) return;
  lastSignature = signature;
  tray.setToolTip(tooltip);
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

/** 任务状态变了：用最新的任务列表刷新提示和菜单。 */
export function refreshTray(next: readonly TaskState[]): void {
  tasks = next;
  render();
}

/** 创建托盘图标（app ready 之后调用一次）。 */
export function createTray(): void {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(iconPath()));
  tray.setToolTip(t(resolveLocale(), "notify.tray.name"));
  tray.on("click", actions.open);
  // 右键菜单在显示前重新生成不可行（setContextMenu 才生效），鼠标移上图标时先刷新，覆盖语言切换。
  tray.on("mouse-move", render);
  render();
  app.once("before-quit", () => {
    tray?.destroy();
    tray = null;
  });
}
