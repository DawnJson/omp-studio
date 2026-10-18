// 通栏顶栏（spec §3.1）：左 ≡ / 侧栏开关 / 后退 / 前进，右侧文字链接位；空白处可拖动窗口，系统三键由 titleBarOverlay 绘制。
import { useT } from "../i18n/use-t.ts";
import { ArrowLeftIcon, ArrowRightIcon, MenuIcon, SidebarIcon } from "./icons.tsx";

interface TopBarProps {
  menuOpen: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  sidebarVisible: boolean;
  onToggleMenu(): void;
  onToggleSidebar(): void;
  onBack(): void;
  onForward(): void;
}

export function TopBar(props: TopBarProps) {
  const t = useT();
  const backLabel = `${t("window.back")} (Alt+←)`;
  const forwardLabel = `${t("window.forward")} (Alt+→)`;
  // 置灰但保持可聚焦（aria-disabled）：键盘用户能找到按钮，也不会因为按钮消失让布局跳动。
  const guard = (enabled: boolean, action: () => void) => () => {
    if (enabled) action();
  };

  return (
    <header className="topbar" data-testid="topbar">
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
        <MenuIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        data-testid="topbar-sidebar"
        aria-label={t("window.toggleSidebar")}
        aria-pressed={props.sidebarVisible}
        title={`${t("window.toggleSidebar")} (Ctrl B)`}
        onClick={props.onToggleSidebar}
      >
        <SidebarIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        data-testid="topbar-back"
        aria-label={t("window.back")}
        aria-disabled={!props.canGoBack}
        title={backLabel}
        onClick={guard(props.canGoBack, props.onBack)}
      >
        <ArrowLeftIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        data-testid="topbar-forward"
        aria-label={t("window.forward")}
        aria-disabled={!props.canGoForward}
        title={forwardLabel}
        onClick={guard(props.canGoForward, props.onForward)}
      >
        <ArrowRightIcon />
      </button>
    </header>
  );
}
