// 任务行和项目头的菜单内容与动作（spec §4.2、§4.3）。返回要渲染的菜单元素和两个打开函数。
import { reportError } from "../../ui/errors.ts";
import { useCallback, useState, type ReactNode } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Project, TaskId, TaskState } from "../../../../shared/ipc.ts";
import { pushToast } from "../dialogs/index.ts";
import { archiveWithUndo } from "./archive-store.ts";
import { Menu, type MenuAnchor, type MenuItem } from "./Menu.tsx";
import { refreshProjects } from "./projects-store.ts";

interface OpenMenu {
  anchor: MenuAnchor;
  items: MenuItem[];
  label: string;
}

interface MenusOptions {
  t: TFunction;
  selectedTaskId: TaskId | null;
  /** 项目下还没归档的任务数（侧栏看到的），用于在调用主进程之前就拒绝移除。 */
  taskCount(project: Project): number;
  onRename(task: TaskState): void;
}

async function attempt(t: TFunction, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    reportError(t, error);
  }
}

export function useSidebarMenus({ t, selectedTaskId, taskCount, onRename }: MenusOptions): {
  menu: ReactNode;
  openTaskMenu(task: TaskState, x: number, y: number, trigger: HTMLElement): void;
  openProjectMenu(project: Project, x: number, y: number, trigger: HTMLElement): void;
} {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const copySession = (task: TaskState, pick: "sessionId" | "sessionFile") =>
    attempt(t, async () => {
      const ref = await window.studio.getTaskSessionRef(task.id);
      if (ref === null) pushToast({ level: "info", message: t("task.noSession") });
      else await navigator.clipboard.writeText(ref[pick]);
    });

  const openTaskMenu = (task: TaskState, x: number, y: number, trigger: HTMLElement) =>
    setOpen({
      anchor: { x, y, returnFocus: trigger },
      label: t("task.more"),
      items: [
        { id: "rename", label: t("task.rename"), shortcut: "F2", onSelect: () => onRename(task) },
        { id: "reveal", label: t("task.reveal"), onSelect: () => void attempt(t, () => window.studio.revealTaskSession(task.id)) },
        { id: "copyId", label: t("task.copyId"), onSelect: () => void copySession(task, "sessionId") },
        { id: "copyPath", label: t("task.copyPath"), onSelect: () => void copySession(task, "sessionFile") },
        { id: "archive", label: t("task.archive"), shortcut: "Del", onSelect: () => archiveWithUndo(task.id, selectedTaskId, t) },
      ],
    });

  const openProjectMenu = (project: Project, x: number, y: number, trigger: HTMLElement) =>
    setOpen({
      anchor: { x, y, returnFocus: trigger },
      label: t("sidebar.projectMenu"),
      items: [
        { id: "reveal", label: t("project.reveal"), onSelect: () => void attempt(t, () => window.studio.revealProject(project.id)) },
        {
          id: "remove",
          label: t("project.remove"),
          onSelect: () => {
            if (taskCount(project) > 0) {
              pushToast({ level: "warning", message: t("project.removeBlocked") });
              return;
            }
            void attempt(t, async () => {
              await window.studio.removeProject(project.id);
              await refreshProjects();
            });
          },
        },
      ],
    });

  const menu = open === null ? null : <Menu anchor={open.anchor} items={open.items} label={open.label} onClose={close} />;
  return { menu, openTaskMenu, openProjectMenu };
}
