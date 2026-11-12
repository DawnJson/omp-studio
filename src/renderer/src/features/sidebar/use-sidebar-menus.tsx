// 任务行、历史会话行和项目头的菜单内容与动作（spec §4.2、§4.3）。返回要渲染的菜单元素和打开函数。
// 任务菜单和顶栏 ⋯ 是同一份（task-menu.tsx）。
import { useCallback, useState, type ReactNode } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Project, SessionSummary, TaskId, TaskState } from "../../../../shared/ipc.ts";
import { hasProcess, taskTitle, sessionTitle } from "../../../../shared/ui/sidebar-model.ts";
import { Branch, Close, Folder, Trash } from "../../icons.tsx";
import { Menu, type MenuAnchor, type MenuEntry } from "../../ui/Menu.tsx";
import { cleanupOrphans } from "../git/git-actions.ts";
import { refreshProjects } from "./projects-store.ts";
import { attempt, buildTaskMenu } from "./task-menu.tsx";
import { confirmDelete } from "./delete-session.tsx";
import { ArchiveIcon } from "./icons.tsx";
import { isTaskPinned, refreshHistorySessions } from "./use-history-sessions.ts";

interface OpenMenu {
  anchor: MenuAnchor;
  items: MenuEntry[];
  label: string;
}

interface MenusOptions {
  t: TFunction;
  selectedTaskId: TaskId | null;
  onRename(task: TaskState): void;
}

export function useSidebarMenus({ t, selectedTaskId, onRename }: MenusOptions): {
  menu: ReactNode;
  openTaskMenu(task: TaskState, x: number, y: number, trigger: HTMLElement): void;
  openSessionMenu(session: SessionSummary, x: number, y: number, trigger: HTMLElement): void;
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
        title: taskTitle(task),
        keepAlive: task.keepAlive,
        live: hasProcess(task),
        restartable: task.restartable,
        pinned: isTaskPinned(task.id),
        selectedTaskId,
        onRename: () => onRename(task),
      }),
    });

  // 历史会话（终端里开的、归档过的任务的）：没归档的可以归档；都可以删除（删除确认框，经 omp 的 `/delete`）。
  // 归档了的从"已归档"点开就恢复，菜单里只有删除。
  const openSessionMenu = (session: SessionSummary, x: number, y: number, trigger: HTMLElement) => {
    const remove: MenuEntry = {
      id: "delete",
      label: t("task.delete"),
      icon: <Trash />,
      tone: "danger",
      testId: "session-menu-delete",
      onSelect: () => confirmDelete({ kind: "session", sessionId: session.id, title: sessionTitle(session) ?? "" }),
    };
    setOpen({
      anchor: { x, y, returnFocus: trigger },
      label: t("task.more"),
      items: session.archived
        ? [remove]
        : [
            {
              id: "archive",
              label: t("task.archive"),
              icon: <ArchiveIcon />,
              onSelect: () =>
                void attempt(t, async () => {
                  await window.studio.archiveSession(session.id);
                  await refreshProjects();
                  refreshHistorySessions();
                }),
            },
            { kind: "separator", id: "sep-delete" },
            remove,
          ],
    });
  };

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
          // 只藏起来：任务不归档、在跑的照跑；再打开这个文件夹就回来（issue #9）。
          id: "remove",
          label: t("project.remove"),
          // × 而不是垃圾桶：只是从列表里拿掉，什么都不删。
          icon: <Close />,
          onSelect: () =>
            void attempt(t, async () => {
              await window.studio.removeProject(project.id);
              await refreshProjects();
            }),
        },
      ],
    });

  const menu =
    open === null ? null : <Menu anchor={open.anchor} items={open.items} label={open.label} onClose={close} />;
  return { menu, openTaskMenu, openSessionMenu, openProjectMenu };
}
