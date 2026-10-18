// 顶栏 = 任务条（direction-2.6 §3）：左 标志 + ≡ 菜单；中 `项目 / 任务标题` + 运行状态；右侧系统三键由 titleBarOverlay 绘制。
// 空白处可拖动窗口。后退/前进不在顶栏（Alt+←/→、鼠标侧键），侧栏开关在菜单和 Ctrl B。
import { useT } from "../i18n/use-t.ts";
import { Logo } from "../ui/Logo.tsx";
import { MenuIcon } from "./icons.tsx";
import { TaskCrumb } from "./TaskCrumb.tsx";

interface TopBarProps {
  menuOpen: boolean;
  onToggleMenu(): void;
}

export function TopBar(props: TopBarProps) {
  const t = useT();
  return (
    <header className="topbar" data-testid="topbar">
      <div className="topbar-left">
        <Logo size={22} />
        <button
          type="button"
          className="icon-button"
          data-testid="topbar-menu"
          aria-label={t("window.menu")}
          aria-haspopup="menu"
          aria-expanded={props.menuOpen}
          title={`${t("window.menu")} (Alt)`}
          onClick={props.onToggleMenu}
        >
          <MenuIcon size={16} />
        </button>
      </div>
      <TaskCrumb />
    </header>
  );
}
