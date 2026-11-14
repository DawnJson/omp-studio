// 文件链接直接预览、原生文件右键菜单，以及隔离网页内容的登记/释放。
import path from "node:path";
import { realpath } from "node:fs/promises";
import { clipboard, Menu, shell } from "electron";
import { createT } from "../../shared/i18n/index.ts";
import { limits, type HandlerGroup } from "../../shared/ipc.ts";
import { readPreviewFile } from "../files/preview-file.ts";
import { resolveLocale } from "../settings/settings-store.ts";
import { getMainWindow } from "../window/main-window.ts";
import { registerPreview, releasePreview } from "../window/preview-protocol.ts";
import { fileHandlers, parseFilesTarget, targetCwd } from "./file-handlers.ts";
import { assertLocalFilePath } from "./task-file-path.ts";
import { parseString, parseTaskId } from "./validate.ts";

function localPreviewPath(cwd: string, input: unknown): string {
  const requested = parseString(input, "path", 1024);
  if (requested.includes("\0") || /^[\\/]{2}/.test(requested) || /^[a-z]:(?![\\/])/i.test(requested))
    throw new Error("file preview only supports local absolute paths");
  const file = path.resolve(cwd, requested);
  assertLocalFilePath(file);
  return file;
}

export const previewHandlers: HandlerGroup<
  "registerHtmlPreview" | "releaseHtmlPreview" | "readLinkedPreviewFile" | "showFileContextMenu"
> = {
  async showFileContextMenu(target, input) {
    const file = localPreviewPath(await targetCwd(parseFilesTarget(target)), input);
    const window = getMainWindow();
    if (!window) return;
    const t = createT(resolveLocale());
    await new Promise<void>((resolve, reject) => {
      let picked = false;
      const run = (action: () => void | Promise<void>) => {
        picked = true;
        Promise.resolve().then(action).then(resolve, reject);
      };
      Menu.buildFromTemplate([
        { id: "copyPath", label: t("preview.copyPath"), click: () => run(() => clipboard.writeText(file)) },
        {
          id: "reveal",
          label: t("preview.openInFileManager"),
          click: () =>
            run(async () => {
              const actual = await realpath(file);
              assertLocalFilePath(actual);
              shell.showItemInFolder(actual);
            }),
        },
      ]).popup({
        window,
        callback: () => {
          if (!picked) resolve();
        },
      });
    });
  },
  async readLinkedPreviewFile(taskId, input) {
    const target = { kind: "task" as const, taskId: parseTaskId(taskId) };
    const file = localPreviewPath(await targetCwd(target), input);
    try {
      return { ...(await fileHandlers.readPreviewFile(target, file)), path: file };
    } catch (error) {
      // 仅词法上位于工作区外的路径走只读预览；实际路径/符号链接错误仍拒绝。
      if (!(error instanceof Error) || error.message !== "path must be relative to the task directory") throw error;
      return {
        ...(await readPreviewFile(path.dirname(file), path.basename(file))),
        path: file,
        external: true,
        canOpen: false,
      };
    }
  },
  async registerHtmlPreview(html) {
    return registerPreview(parseString(html, "html", limits.htmlPreviewMaxChars, { allowEmpty: true }));
  },
  async releaseHtmlPreview(token) {
    releasePreview(parseString(token, "token", 64));
  },
};
