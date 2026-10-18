// 拖放文件夹（只给 preload 用的内部通道，见 ipc.ts 的 dropFolderChannel）：路径不可信，
// 必须是绝对路径且确实是目录；不是目录（图片、文件）静默忽略。目录交给任务运行时的项目存储。
import { ipcMain } from "electron";
import { stat } from "node:fs/promises";
import path from "node:path";
import { dropFolderChannel, limits } from "../../shared/ipc.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { emitEvent } from "./events.ts";
import { assertTrustedSender } from "./validate.ts";

export function registerDropFolder(): void {
  ipcMain.handle(dropFolderChannel, async (event, value: unknown) => {
    assertTrustedSender(event);
    if (typeof value !== "string" || value.length === 0 || value.length > limits.urlMaxChars || !path.isAbsolute(value)) return;
    const info = await stat(value).catch(() => null);
    if (!info?.isDirectory()) return;
    emitEvent("projectDropped", await (await getTaskPool()).ensureProject(value));
  });
}
