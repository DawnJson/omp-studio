// 顶栏任务工具里的"⋯"任务菜单：和侧栏任务行的 ⋯ / 右键是同一份菜单（features/sidebar/task-menu.tsx）。只给有任务的对话页；菜单项每次渲染现算。
// 重命名：侧栏订阅 rename 命令，给当前任务就地改名（侧栏收起时 App 先把它展开）。
import { useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Dots } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { Menu, anchorBelow, type MenuAnchor } from "../../ui/Menu.tsx";
import { emitStudioCommand } from "../palette/studio-command.ts";
import { buildTaskMenu } from "../sidebar/task-menu.tsx";

export function SessionMenu({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  return (
    <>
      <IconButton
        label={t("sessionInfo.menu.label")}
        testId="task-menu"
        expanded={menu !== null}
        aria-haspopup="menu"
        onClick={(event) => setMenu(menu === null ? anchorBelow(event.currentTarget) : null)}
      >
        <Dots />
      </IconButton>
      {menu !== null && (
        <Menu
          anchor={menu}
          items={buildTaskMenu({
            t,
            taskId,
            selectedTaskId: taskId,
            onRename: () => emitStudioCommand("rename"),
          })}
          label={t("sessionInfo.menu.label")}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
