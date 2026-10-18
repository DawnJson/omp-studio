// 主进程 → 渲染进程的事件推送。渲染进程只订阅 StudioEventPayloads 里的事件（preload 转发）。
import { eventChannel, type StudioEventPayloads } from "../../shared/ipc.ts";
import { getMainWindow } from "../window/main-window.ts";

export function emitEvent<K extends keyof StudioEventPayloads>(name: K, payload: StudioEventPayloads[K]): void {
  const window = getMainWindow();
  if (window && !window.webContents.isDestroyed()) window.webContents.send(eventChannel(name), payload);
}
