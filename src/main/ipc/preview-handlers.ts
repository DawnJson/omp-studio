// 文件预览：单文件系统选择、原生文件右键菜单，以及隔离网页内容的登记/释放。
import path from "node:path";
import { realpath } from "node:fs/promises";
import { clipboard, dialog, Menu, shell } from "electron";
import { createT } from "../../shared/i18n/index.ts";
import { limits, type HandlerGroup } from "../../shared/ipc.ts";
import { readPreviewFile } from "../files/preview-file.ts";
import { resolveLocale } from "../settings/settings-store.ts";
import { getMainWindow } from "../window/main-window.ts";
import { registerPreview, releasePreview } from "../window/preview-protocol.ts";
import { parseFilesTarget, targetCwd } from "./file-handlers.ts";
import { assertLocalFilePath } from "./task-file-path.ts";
import { parseString } from "./validate.ts";

function localPreviewPath(cwd: string, input: unknown): string {
  const requested = parseString(input, "path", 1024);
  if (requested.includes("\0") || /^[\\/]{2}/.test(requested) || /^[a-z]:(?![\\/])/i.test(requested))
    throw new Error("file preview only supports local absolute paths");
  const file = path.resolve(cwd, requested);
  assertLocalFilePath(file);
  return file;
}

export const previewHandlers: HandlerGroup<
  "registerHtmlPreview" | "releaseHtmlPreview" | "choosePreviewFile" | "showFileContextMenu"
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
  async choosePreviewFile(target, input) {
    const parsed = parseFilesTarget(target);
    const defaultPath = localPreviewPath(await targetCwd(parsed), input);
    const window = getMainWindow();
    if (!window) return null;
    const t = createT(resolveLocale());
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      defaultPath,
      title: t("preview.chooseFileTitle"),
      buttonLabel: t("preview.pagePreview"),
    });
    const selected = result.filePaths[0];
    if (result.canceled || selected === undefined) return null;
    assertLocalFilePath(selected);
    await targetCwd(parsed);
    const file = await readPreviewFile(path.dirname(selected), path.basename(selected));
    return { ...file, path: selected, canOpen: false };
  },
  async registerHtmlPreview(html) {
    return registerPreview(parseString(html, "html", limits.htmlPreviewMaxChars, { allowEmpty: true }));
  },
  async releaseHtmlPreview(token) {
    releasePreview(parseString(token, "token", 64));
  },
};
