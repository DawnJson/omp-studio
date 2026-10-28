// 任务行和项目头的菜单内容与动作（spec §4.2、§4.3）。返回要渲染的菜单元素和两个打开函数。
// 任务菜单和顶栏 ⋯ 是同一份（task-menu.tsx）。
import { useCallback, useState, type ReactNode } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Project, TaskId, TaskState } from "../../../../shared/ipc.ts";
import { Branch, Folder, Trash } from "../../icons.tsx";
import { Menu, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";
import { pushToast } from "../dialogs/index.ts";
import { cleanupOrphans } from "../git/git-actions.ts";
import { refreshProjects } from "./projects-store.ts";
import { attempt, buildTaskMenu } from "./task-menu.tsx";

interface OpenMenu {
  anchor: MenuAnchor;
  items: MenuEntry[];
  label: string;
}

interface MenusOptions {
  t: TFunction;
  selectedTaskId: TaskId | null;
  /** 项目下还没归档的任务数（侧栏看到的），用于在调用主进程之前就拒绝移除。 */
  taskCount(project: Project): number;
  onRename(task: TaskState): void;
}

export function useSidebarMenus({ t, selectedTaskId, taskCount, onRename }: MenusOptions): {
  menu: ReactNode;
  openTaskMenu(task: TaskState, x: number, y: number, trigger: HTMLElement): void;
  openProjectMenu(project: Project, x: number, y: number, trigger: HTMLElement): void;
} {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const openTaskMenu = (task: TaskState, x: number, y: number, trigger: HTMLElement) =>
    setOpen({
      anchor: { x, y, returnFocus: trigger },
      label: t("task.more"),
      items: buildTaskMenu({
        t,
        taskId: task.id,
        keepAlive: task.keepAlive,
        selectedTaskId,
        onRename: () => onRename(task),
      }),
    });

  const openProjectMenu = (project: Project, x: number, y: number, trigger: HTMLElement) =>
    setOpen({
      anchor: { x, y, returnFocus: trigger },
      label: t("sidebar.projectMenu"),
      items: [
        {
          id: "reveal",
          label: t("project.reveal"),
          icon: <Folder />,
          onSelect: () => void attempt(t, () => window.studio.revealProject(project.id)),
        },
        {
          id: "cleanupWorktrees",
          label: t("git.menu.cleanup"),
          icon: <Branch />,
          onSelect: () => void cleanupOrphans(t, project.id),
        },
        { kind: "separator", id: "sep-remove" },
        {
          id: "remove",
          label: t("project.remove"),
          icon: <Trash />,
          tone: "danger",
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

  const menu =
    open === null ? null : <Menu anchor={open.anchor} items={open.items} label={open.label} onClose={close} />;
  return { menu, openTaskMenu, openProjectMenu };
}
