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
import { getTaskPool } from "../tasks/runtime.ts";
import { fileHandlers, parseFilesTarget, targetCwd } from "./file-handlers.ts";
import { assertLocalFilePath, isInside } from "./task-file-path.ts";
import { parseString, parseTaskId } from "./validate.ts";

function localPreviewPath(cwd: string, input: unknown): string {
  const requested = parseString(input, "path", 1024);
  // 盘符相对路径（`C:foo`）会被 path.resolve 拼到该盘的当前目录上，先拒绝；网络、设备路径和 NUL 由 assertLocalFilePath 拒绝。
  if (/^[a-z]:(?![\\/])/i.test(requested)) throw new Error("file preview only supports local absolute paths");
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
    const id = parseTaskId(taskId);
    const pool = await getTaskPool();
    const cwd = pool.taskCwd(id);
    const file = localPreviewPath(cwd, input);
    // 在任务目录或已加入的工作区里：走工作区读取（符号链接越界照常拒绝，额外根带回 root）；否则只读这一个文件。
    if ([cwd, ...pool.taskWorkspaceDirs(id)].some((root) => isInside(root, file)))
      return { ...(await fileHandlers.readPreviewFile({ kind: "task", taskId: id }, file)), path: file };
    return {
      ...(await readPreviewFile(path.dirname(file), path.basename(file))),
      path: file,
      external: true,
      canOpen: false,
    };
  },
  async registerHtmlPreview(html) {
    return registerPreview(parseString(html, "html", limits.htmlPreviewMaxChars, { allowEmpty: true }));
  },
  async releaseHtmlPreview(token) {
    releasePreview(parseString(token, "token", 64));
  },
};
