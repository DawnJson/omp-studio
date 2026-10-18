// 沙箱里的 preload：只把 StudioApi 的每个函数转发成一个 ipcRenderer 调用，不暴露 ipcRenderer 本身。
// 打包成 CJS（electron.vite.config.ts）；这里不写任何业务逻辑，校验在主进程（src/main/ipc/validate.ts）。
import { contextBridge, ipcRenderer } from "electron";
import { eventChannel, eventNames, invokeChannel, invokeNames, type StudioApi } from "../shared/ipc.ts";

const entries: [string, unknown][] = [];

for (const name of Object.keys(invokeNames) as (keyof typeof invokeNames)[]) {
  entries.push([name, (...args: unknown[]) => ipcRenderer.invoke(invokeChannel(name), ...args)]);
}

for (const name of Object.keys(eventNames) as (keyof typeof eventNames)[]) {
  const subscribe = (listener: (payload: unknown) => void) => {
    const channel = eventChannel(name);
    const forward = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, forward);
    return () => {
      ipcRenderer.removeListener(channel, forward);
    };
  };
  entries.push([`on${name.charAt(0).toUpperCase()}${name.slice(1)}`, subscribe]);
}

// Object.fromEntries 丢了每个函数的参数类型；完整性由 invokeNames/eventNames 的 satisfies 在编译期保证。
const api = Object.fromEntries(entries) as unknown as StudioApi;

contextBridge.exposeInMainWorld("studio", api);
