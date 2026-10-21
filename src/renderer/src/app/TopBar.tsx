// 顶栏 = 任务条（spec §3.1）：左 标志+字标、切换侧栏按钮（图标随侧栏显隐变化）、"关于与反馈"图标按钮；中 任务标题 + 状态胶囊；
// 右 任务工具（分支、评审、文件面板、终端），再往右是 titleBarOverlay 绘制的系统三键。空白处可拖动窗口。后退/前进不在顶栏（Alt+←/→、鼠标侧键）。
import { FilesToggle } from "../features/file-preview/index.ts";
import { GitTools } from "../features/git/index.ts";
import { SessionMenu } from "../features/session-info/index.ts";
import { TerminalToggle, useDraftTerminalKey } from "../features/terminal/index.ts";
import { useT } from "../i18n/use-t.ts";
import { InfoIcon, SidebarIcon } from "./icons.tsx";
import { useMainView, useSelectedTaskId, useTask } from "../store/index.ts";
import { PixelLogo } from "../ui/PixelLogo.tsx";
import { TaskCrumb } from "./TaskCrumb.tsx";

interface TopBarProps {
  aboutOpen: boolean;
  onOpenAbout(): void;
  sidebarShown: boolean;
  onToggleSidebar(): void;
}

/** 对话页上出现：任务有分支、评审、文件面板、终端；新任务草稿有文件面板（草稿有项目时）和终端。最右一条竖线把它们和系统三键隔开。 */
function TaskTools() {
  const view = useMainView();
  const taskId = useSelectedTaskId();
  const task = useTask(taskId);
  const draftKey = useDraftTerminalKey();
  if (view !== "conversation" || (taskId !== null && task === null)) return null;
  return (
    <div className="topbar-tools" data-testid="topbar-tools">
      {taskId !== null && <GitTools taskId={taskId} />}
      <FilesToggle panelKey={taskId ?? draftKey} />
      <TerminalToggle terminalKey={taskId ?? draftKey} />
      {taskId !== null && <SessionMenu taskId={taskId} />}
      <span className="topbar-divider" aria-hidden="true" />
    </div>
  );
}

export function TopBar(props: TopBarProps) {
  const t = useT();
  return (
    <header className="topbar" data-testid="topbar">
      <div className="topbar-left">
        <span className="topbar-brand" data-testid="topbar-brand">
          <PixelLogo unit={2} />
        </span>
        <button
          type="button"
          className="topbar-tool"
          data-testid="topbar-sidebar"
          aria-label={t("menu.toggleSidebar")}
          aria-expanded={props.sidebarShown}
          title={`${t("menu.toggleSidebar")} (Ctrl B)`}
          onClick={props.onToggleSidebar}
        >
          <SidebarIcon shown={props.sidebarShown} />
        </button>
        <button
          type="button"
          className="topbar-tool"
          data-testid="topbar-about"
          aria-haspopup="dialog"
          aria-expanded={props.aboutOpen}
          aria-label={t("window.about")}
          title={t("window.about")}
          onClick={props.onOpenAbout}
        >
          <InfoIcon />
        </button>
      </div>
      <TaskCrumb />
      <TaskTools />
    </header>
  );
}
