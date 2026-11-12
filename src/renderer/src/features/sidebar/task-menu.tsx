// 任务菜单：侧栏任务行的 ⋯ / 右键和顶栏的 ⋯ 打开的是同一份（项一致、顺序一致）。
// 第一组是任务本身（重命名、置顶、保持运行、关闭会话、会话信息、会话树、请求记录、分享链接），第二组是文件（工作目录、会话文件、复制、导出），最后是归档和删除。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { Bolt, Branch, CopyIcon, External, FileIcon, Folder, Info, Pencil, Pin, Trash } from "../../icons.tsx";
import { selectTask } from "../../store/index.ts";
import { openSessionTree } from "../conversation/session-tree-store.ts";
import { reportError } from "../../ui/errors.ts";
import type { MenuEntry } from "../../ui/Menu.tsx";
import { pushToast } from "../dialogs/index.ts";
import { exportConversationReporting } from "../composer/export-html.ts";
import { openSessionInfo, openShareDialog } from "../session-info/session-info-store.ts";
import { togglePin } from "../session-info/session-info-actions.ts";
import { archiveWithUndo } from "./archive-store.ts";
import { confirmDelete } from "./delete-session.tsx";
import { ArchiveIcon, ExportIcon, ProcessIcon, StopIcon } from "./icons.tsx";

export async function attempt(t: TFunction, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    reportError(t, error);
  }
}

/** 复制会话 ID / 会话文件路径：菜单关了看不到按钮，成功给 toast（同过程区的复制）。 */
async function copySession(t: TFunction, taskId: TaskId, pick: "sessionId" | "sessionFile"): Promise<void> {
  await attempt(t, async () => {
    const ref = await window.studio.getTaskSessionRef(taskId);
    if (ref === null) {
      pushToast({ level: "info", message: t("task.noSession") });
      return;
    }
    await navigator.clipboard.writeText(ref[pick]);
    pushToast({ message: t("common.copied") });
  });
}

export function buildTaskMenu(options: {
  t: TFunction;
  taskId: TaskId;
  /** 显示用的标题（去掉图标字形；空串 = 未命名），删除确认框里用。 */
  title: string;
  keepAlive: boolean;
  /** 任务现在有 omp 进程（idle / running / needs_you）：这时才有"关闭会话"。 */
  live: boolean;
  /** TaskState.restartable：有进程时 = 空闲、可以关；为 false 时"关闭会话"灰显。 */
  restartable: boolean;
  /** 任务的会话在 omp 的置顶列表里（`session-pins.json`）。 */
  pinned: boolean;
  selectedTaskId: TaskId | null;
  onRename(): void;
}): MenuEntry[] {
  const { t, taskId } = options;
  const entries: (MenuEntry | false)[] = [
    { id: "rename", label: t("task.rename"), icon: <Pencil />, shortcut: "F2", onSelect: options.onRename },
    // 置顶走 omp 的 `/pin`（和终端版的恢复列表共用，session-history.md「置顶」）；没在跑的任务会先起进程。
    {
      id: "pin",
      label: t(options.pinned ? "task.unpin" : "task.pin"),
      icon: <Pin />,
      testId: "task-menu-pin",
      onSelect: () => void togglePin(t, taskId),
    },
    {
      id: "keepAlive",
      label: t(options.keepAlive ? "task.keepAliveOff" : "task.keepAlive"),
      icon: <Bolt />,
      onSelect: () => void attempt(t, () => window.studio.setTaskKeepAlive(taskId, !options.keepAlive)),
    },
    // 关闭会话（issue #11）：结束 omp 进程，对话留着；再点开或发消息时 `--resume` 同一个会话。终端里要接着用这个会话时先在这里关掉，
    // 否则两边的 omp 写同一个会话，后写的那个会被 omp 分叉成新文件。忙的时候主进程也拒绝。
    options.live && {
      id: "close",
      label: t("task.close"),
      icon: <StopIcon />,
      testId: "task-menu-close",
      disabled: !options.restartable,
      title: options.restartable ? undefined : t("task.closeBusy"),
      onSelect: () => void attempt(t, () => window.studio.closeTask(taskId)),
    },
    { id: "info", label: t("sessionInfo.menu.info"), icon: <Info />, onSelect: () => openSessionInfo(taskId, "info") },
    // 会话树面板只画在当前任务的对话页上：侧栏里别的任务先选中再打开（2026-11-09 仓库所有者定：会话树的入口放进任务菜单）。
    {
      id: "sessionTree",
      label: t("cmd.sessionTree"),
      icon: <Branch />,
      onSelect: () =>
        void attempt(t, async () => {
          if (taskId !== options.selectedTaskId) await selectTask(taskId);
          openSessionTree(taskId);
        }),
    },
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
    // 真删除（issue #10，2026-11-10 仓库所有者批准）：先弹 danger 确认框，经 omp 的 `/delete` 删掉会话文件，不可撤销。
    {
      id: "delete",
      label: t("task.delete"),
      icon: <Trash />,
      tone: "danger",
      testId: "task-menu-delete",
      onSelect: () => confirmDelete({ kind: "task", taskId, title: options.title }),
    },
  ];
  return entries.filter((entry): entry is MenuEntry => entry !== false);
}
