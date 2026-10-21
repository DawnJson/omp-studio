// `/dirs`、`/add-dir`、`/remove-dir`（spec §4.27）：studio 自己的界面是文件面板顶部的"工作区目录"行，这三条命令只是它的快捷入口。
// 命令文本由主进程按封闭的 TaskCommand 拼（shared/omp-output），路径是用户在输入框里自己打的整行（不加引号，omp 会把引号当路径的一部分）。
import { parseDirsOutput } from "../../../../shared/omp-output/dirs.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { pushToast } from "../dialogs/index.ts";
import type { StudioSlashCommand } from "../composer/studio-slash.ts";
import { baseName } from "./PreviewContent.tsx";
import { openFilesPanel } from "./preview-store.ts";
import { selectRoot, selectRootWhenListed } from "./roots-store.ts";

/** 命令成功后：打开文件面板；刚加进来的目录就选中它。 */
function showResult(taskId: TaskId, text: string): void {
  openFilesPanel(taskId);
  const parsed = parseDirsOutput(text);
  if (parsed.kind !== "dirs") return;
  if (parsed.notice?.kind === "added") {
    const at = parsed.dirs.indexOf(parsed.notice.path);
    if (at >= 0) selectRootWhenListed(taskId, at + 1);
  } else if (parsed.notice?.kind === "removed") {
    selectRoot(taskId, 0);
  }
}

export const dirsSlashCommands: readonly StudioSlashCommand[] = [
  {
    name: "dirs",
    descKey: "slash.dirsDesc",
    tsp: "studio",
    run: async (taskId) => {
      await window.studio.refreshWorkspaceDirs(taskId);
      openFilesPanel(taskId);
    },
  },
  {
    name: "add-dir",
    descKey: "slash.addDirDesc",
    tsp: "studio",
    run: async (taskId, args, t) => {
      // 不带路径：系统文件夹选择框（主进程）；带路径：按用户输入的整行交给 omp（相对路径按任务目录解析）。
      const result =
        args === ""
          ? await window.studio.addWorkspaceDir(taskId)
          : await window.studio.runTaskCommand(taskId, { kind: "addDir", path: args });
      if (result === null) return;
      showResult(taskId, result.text);
      const parsed = parseDirsOutput(result.text);
      if (parsed.kind === "dirs" && parsed.notice?.kind === "added")
        pushToast({ level: "info", message: t("preview.dirAdded", { name: baseName(parsed.notice.path) }) });
    },
  },
  {
    name: "remove-dir",
    descKey: "slash.removeDirDesc",
    tsp: "studio",
    run: async (taskId, args, t) => {
      if (args === "") {
        openFilesPanel(taskId);
        return;
      }
      const result = await window.studio.runTaskCommand(taskId, { kind: "removeDir", path: args });
      showResult(taskId, result.text);
      const parsed = parseDirsOutput(result.text);
      if (parsed.kind === "dirs" && parsed.notice?.kind === "removed")
        pushToast({ level: "info", message: t("preview.dirRemoved", { name: baseName(parsed.notice.path) }) });
    },
  },
];
