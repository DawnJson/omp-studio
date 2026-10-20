// 沙箱里的 preload：只把 StudioApi 的每个函数转发成一个 ipcRenderer 调用，不暴露 ipcRenderer 本身。
// 打包成 CJS（electron.vite.config.ts）；这里不写任何业务逻辑，校验在主进程（src/main/ipc/validate.ts）。
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  dropFolderChannel,
  eventChannel,
  eventNames,
  invokeChannel,
  invokeNames,
  type StudioApi,
} from "../shared/ipc.ts";

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

// 拖放文件夹：File 对象不能穿过 contextBridge，路径只能在这里（隔离世界）取。拿到后直接发给主进程，
// 渲染进程既拿不到路径，也没有可传路径的函数。主进程校验是目录才处理，其余（图片等）什么也不发生。
interface DropEvent extends Event {
  dataTransfer: { files: ArrayLike<File> } | null;
}
// 沙箱 preload 里的 window；node 工程没有 DOM 类型，只用到 EventTarget 的接口。
const pageWindow = globalThis as unknown as EventTarget;
pageWindow.addEventListener(
  "drop",
  (event) => {
    const file = (event as DropEvent).dataTransfer?.files[0];
    if (file) void ipcRenderer.invoke(dropFolderChannel, webUtils.getPathForFile(file));
  },
  true,
);

// 粘贴文件（资源管理器里复制的文件、文件夹）进输入框：和终端里一样插入路径，有空白的加引号，多个用空格隔开。
// 路径同样只在这里取（理由同上），用 execCommand("insertText") 插进正在粘贴的输入框：走输入框自己的 input 事件，
// 能撤销。图片不管，交给输入框的 onPaste 作附件。
interface PasteEvent extends Event {
  clipboardData: { files: ArrayLike<File> } | null;
}
interface PageDocument {
  execCommand(command: string, showUi: boolean, value: string): boolean;
}
// 沙箱 preload 里的全局对象（页面的 document 在上面）；同 pageWindow，没有 DOM 类型，只用到 execCommand。
const pageGlobal = globalThis as unknown as { document: PageDocument };
/** 粘贴目标是不是输入框（带 data-composer-input 的 textarea）。 */
function isComposerInput(target: EventTarget | null): boolean {
  return (
    target !== null &&
    "hasAttribute" in target &&
    typeof target.hasAttribute === "function" &&
    target.hasAttribute("data-composer-input") === true
  );
}
const quotePath = (path: string) => (/\s/.test(path) ? `"${path}"` : path);
pageWindow.addEventListener(
  "paste",
  (event) => {
    if (!isComposerInput(event.target)) return;
    const files = Array.from((event as PasteEvent).clipboardData?.files ?? []);
    const paths = files
      .filter((file) => !file.type.startsWith("image/"))
      .map((file) => webUtils.getPathForFile(file))
      .filter((path) => path !== "");
    if (paths.length === 0) return;
    event.preventDefault();
    pageGlobal.document.execCommand("insertText", false, paths.map(quotePath).join(" "));
  },
  true,
);

contextBridge.exposeInMainWorld("studio", api);
