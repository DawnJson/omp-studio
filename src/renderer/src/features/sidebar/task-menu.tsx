// 任务菜单：侧栏任务行的 ⋯ / 右键和顶栏的 ⋯ 打开的是同一份（项一致、顺序一致）。
// 第一组是任务本身（重命名、会话信息、请求记录、分享链接），第二组是文件（工作目录、会话文件、复制、导出），最后是归档。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { CopyIcon, External, FileIcon, Folder, Info, Pencil } from "../../icons.tsx";
import { reportError } from "../../ui/errors.ts";
import type { MenuEntry } from "../../ui/Menu.tsx";
import { pushToast } from "../dialogs/index.ts";
import { exportConversationReporting } from "../composer/export-html.ts";
import { openSessionInfo, openShareDialog } from "../session-info/session-info-store.ts";
import { archiveWithUndo } from "./archive-store.ts";
import { ArchiveIcon, ExportIcon, ProcessIcon } from "./icons.tsx";

export async function attempt(t: TFunction, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    reportError(t, error);
  }
}

async function copySession(t: TFunction, taskId: TaskId, pick: "sessionId" | "sessionFile"): Promise<void> {
  await attempt(t, async () => {
    const ref = await window.studio.getTaskSessionRef(taskId);
    if (ref === null) pushToast({ level: "info", message: t("task.noSession") });
    else await navigator.clipboard.writeText(ref[pick]);
  });
}

export function buildTaskMenu(options: {
  t: TFunction;
  taskId: TaskId;
  selectedTaskId: TaskId | null;
  onRename(): void;
}): MenuEntry[] {
  const { t, taskId } = options;
  return [
    { id: "rename", label: t("task.rename"), icon: <Pencil />, shortcut: "F2", onSelect: options.onRename },
    { id: "info", label: t("sessionInfo.menu.info"), icon: <Info />, onSelect: () => openSessionInfo(taskId, "info") },
    {
      id: "trace",
      label: t("sessionInfo.menu.trace"),
      icon: <ProcessIcon />,
      onSelect: () => openSessionInfo(taskId, "trace"),
    },
    { id: "share", label: t("sessionInfo.menu.share"), icon: <External />, onSelect: () => openShareDialog(taskId) },
    { kind: "separator", id: "sep-files" },
    // 工作目录 = omp 读写文件、跑命令的地方；会话文件是 omp 自己存在 ~/.omp/agent/sessions 下的记录，两者不是一个地方。
    {
      id: "openFolder",
      label: t("task.openFolder"),
      icon: <Folder />,
      onSelect: () => void attempt(t, () => window.studio.openTaskFolder(taskId)),
    },
    {
      id: "reveal",
      label: t("task.reveal"),
      icon: <FileIcon />,
      onSelect: () => void attempt(t, () => window.studio.revealTaskSession(taskId)),
    },
    {
      id: "copyId",
      label: t("task.copyId"),
      icon: <CopyIcon />,
      onSelect: () => void copySession(t, taskId, "sessionId"),
    },
    {
      id: "copyPath",
      label: t("task.copyPath"),
      icon: <CopyIcon />,
      onSelect: () => void copySession(t, taskId, "sessionFile"),
    },
    {
      id: "exportHtml",
      label: t("task.exportHtml"),
      icon: <ExportIcon />,
      onSelect: () => void exportConversationReporting(taskId, t),
    },
    { kind: "separator", id: "sep-archive" },
    {
      id: "archive",
      label: t("task.archive"),
      icon: <ArchiveIcon />,
      shortcut: "Del",
      onSelect: () => archiveWithUndo(taskId, options.selectedTaskId, t),
    },
  ];
}
