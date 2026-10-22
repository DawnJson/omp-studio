// 输入框的文件附件：preload 的拖入 / 粘贴通道（composerFilesChannel）。
import { ipcMain } from "electron";
import { composerFilesChannel, limits } from "../../shared/ipc.ts";
import { registerComposerFiles } from "../files/composer-files.ts";
import { emitEvent } from "./events.ts";
import { assertTrustedSender } from "./validate.ts";

/** preload 专用：{ paths: string[], paste: boolean }；返回没登记的路径（目录等）。 */
export function registerComposerFilesChannel(): void {
  ipcMain.handle(composerFilesChannel, async (event, value: unknown): Promise<string[]> => {
    assertTrustedSender(event);
    const paths = (value as { paths?: unknown } | null)?.paths;
    if (!Array.isArray(paths) || paths.length > limits.promptMaxFiles) return [];
    const strings = paths.filter(
      (item): item is string => typeof item === "string" && item.length <= limits.urlMaxChars,
    );
    const { files, rest } = await registerComposerFiles(strings);
    if (files.length > 0) emitEvent("composerFilesAdded", files);
    return rest;
  });
}
