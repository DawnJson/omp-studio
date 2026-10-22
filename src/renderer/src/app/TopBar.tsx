// 顶栏 = 任务条（spec §3.1）：左 标志+字标、切换侧栏按钮（图标随侧栏显隐变化）；中 任务标题；
// 右 任务工具（分支、评审、文件面板、终端、任务菜单 ⋯），再往右是 titleBarOverlay 绘制的系统三键。空白处可拖动窗口。后退/前进不在顶栏（Alt+←/→、鼠标侧键）。关于在设置 → 关于和命令面板里。
import { FilesToggle } from "../features/file-preview/index.ts";
import { DraftGitTools, GitTools } from "../features/git/index.ts";
import { SessionMenu } from "../features/session-info/index.ts";
import { TerminalToggle, useDraftTerminalKey } from "../features/terminal/index.ts";
import { useT } from "../i18n/use-t.ts";
import { SidebarIcon } from "./icons.tsx";
import { useDraftProject } from "../features/empty/use-draft-project.ts";
import { useMainView, useSelectedTaskId, useTask } from "../store/index.ts";
import { IconButton } from "../ui/controls.tsx";
import { PixelLogo } from "../ui/PixelLogo.tsx";
import { TaskCrumb } from "./TaskCrumb.tsx";

interface TopBarProps {
  sidebarShown: boolean;
  onToggleSidebar(): void;
}

/** 对话页上出现：任务有分支、评审、文件面板、终端；新任务草稿有分支（项目是 git 仓库根时，可勾选在 worktree 里开始）、文件面板（草稿有项目时）和终端。最右一条竖线把它们和系统三键隔开。 */
function TaskTools() {
  const view = useMainView();
  const taskId = useSelectedTaskId();
  const task = useTask(taskId);
  const draftKey = useDraftTerminalKey();
  const draftProject = useDraftProject();
  if (view !== "conversation" || (taskId !== null && task === null)) return null;
  return (
    <div className="topbar-tools" data-testid="topbar-tools">
      {taskId !== null && <GitTools taskId={taskId} />}
      {taskId === null && draftProject !== null && <DraftGitTools projectId={draftProject.id} />}
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
        <IconButton
          label={t("menu.toggleSidebar")}
          tip={`${t("menu.toggleSidebar")} (Ctrl B)`}
          testId="topbar-sidebar"
          expanded={props.sidebarShown}
          onClick={props.onToggleSidebar}
        >
          <SidebarIcon shown={props.sidebarShown} />
        </IconButton>
      </div>
      <TaskCrumb />
      <TaskTools />
    </header>
  );
}
