// 顶栏 = 任务条（spec §3.1）：左 标志+字标（即应用菜单按钮）；中 任务标题 + 状态胶囊；右 任务工具（分支、评审、终端），再往右是 titleBarOverlay 绘制的系统三键。
// 空白处可拖动窗口。后退/前进不在顶栏（Alt+←/→、鼠标侧键），侧栏开关在菜单和 Ctrl B。
import { GitTools } from "../features/git/index.ts";
import { TerminalToggle } from "../features/terminal/index.ts";
import { useT } from "../i18n/use-t.ts";
import { ChevronDown } from "../icons.tsx";
import { useMainView, useSelectedTaskId, useTask } from "../store/index.ts";
import { Logo } from "../ui/Logo.tsx";
import { TaskCrumb } from "./TaskCrumb.tsx";

interface TopBarProps {
  menuOpen: boolean;
  onToggleMenu(): void;
}

/** 只在有任务的对话页出现；最右一条竖线把它们和系统三键隔开。 */
function TaskTools() {
  const view = useMainView();
  const taskId = useSelectedTaskId();
  const task = useTask(taskId);
  if (view !== "conversation" || taskId === null || task === null) return null;
  return (
    <div className="topbar-tools" data-testid="topbar-tools">
      <GitTools taskId={taskId} />
      <TerminalToggle taskId={taskId} />
      <span className="topbar-divider" aria-hidden="true" />
    </div>
  );
}

export function TopBar(props: TopBarProps) {
  const t = useT();
  return (
    <header className="topbar" data-testid="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-brand"
          data-testid="topbar-menu"
          aria-label={t("window.appMenu")}
          aria-haspopup="menu"
          aria-expanded={props.menuOpen}
          title={`${t("window.menu")} (Alt)`}
          onClick={props.onToggleMenu}
        >
          <Logo size={18} />
          <span className="topbar-wordmark" aria-hidden="true">
            omp <span>studio</span>
          </span>
          <ChevronDown size={12} />
        </button>
      </div>
      <TaskCrumb />
      <TaskTools />
    </header>
  );
}
