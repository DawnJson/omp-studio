// 顶栏任务工具里的"⋯"任务菜单（会话信息、请求记录、分享链接…）。只给有任务的对话页；菜单项每次渲染现算。
import { useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Dots } from "../../icons.tsx";
import { Menu, type MenuAnchor, type MenuItem } from "../sidebar/Menu.tsx";
import { openSessionInfo, openShareDialog } from "./session-info-store.ts";

export function SessionMenu({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const items: MenuItem[] = [
    { id: "info", label: t("sessionInfo.menu.info"), onSelect: () => openSessionInfo(taskId, "info") },
    { id: "trace", label: t("sessionInfo.menu.trace"), onSelect: () => openSessionInfo(taskId, "trace") },
    { id: "share", label: t("sessionInfo.menu.share"), onSelect: () => openShareDialog(taskId) },
  ];
  return (
    <>
      <button
        type="button"
        className="topbar-tool"
        data-testid="task-menu"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={t("sessionInfo.menu.label")}
        title={t("sessionInfo.menu.label")}
        onClick={(event) => {
          if (menu !== null) {
            setMenu(null);
            return;
          }
          const button = event.currentTarget;
          const box = button.getBoundingClientRect();
          setMenu({ x: box.left, y: box.bottom + 4, returnFocus: button });
        }}
      >
        <Dots size={16} />
      </button>
      {menu !== null && (
        <Menu anchor={menu} items={items} label={t("sessionInfo.menu.label")} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
