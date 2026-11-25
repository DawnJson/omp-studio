// 顶栏 = 任务条（spec §3.1）：左 标志+字标、切换侧栏按钮（图标随侧栏显隐变化）；中 任务标签（features/tabs，§4.6）；
// 右 任务工具（子代理面板、浏览器、终端），再往右是 titleBarOverlay 绘制的系统三键。空白处可拖动窗口。文件夹和分支在输入框下方的状态行（§4.14），打开评审在它的 Git 菜单里。任务菜单只在侧栏任务行（⋯ / 右键），顶栏不重复。后退/前进不在顶栏（Alt+←/→、鼠标侧键）。关于在设置 → 关于和命令面板里。
import { AgentsToggle } from "../features/agents/index.ts";
import { BrowserToggle } from "../features/browser/index.ts";
import { TerminalToggle, useDraftTerminalKey } from "../features/terminal/index.ts";
import { useT } from "../i18n/use-t.ts";
import { withShortcut } from "./platform-keys.ts";
import { SidebarIcon } from "./icons.tsx";
import { useMainView, useSelectedTaskId, useTask } from "../store/index.ts";
import { IconButton } from "../ui/controls.tsx";
import { PixelLogo } from "../ui/PixelLogo.tsx";
import { TaskTabs } from "../features/tabs/index.ts";

interface TopBarProps {
  sidebarShown: boolean;
  onToggleSidebar(): void;
}

/** 对话页上出现：任务有子代理面板、浏览器、终端；新任务草稿只有终端。最右一条竖线把它们和系统三键隔开。 */
function TaskTools() {
  const view = useMainView();
  const taskId = useSelectedTaskId();
  const task = useTask(taskId);
  const draftKey = useDraftTerminalKey();
  if (view !== "conversation" || (taskId !== null && task === null)) return null;
  return (
    <div className="topbar-tools" data-testid="topbar-tools">
      {taskId !== null && <AgentsToggle taskId={taskId} />}
      {taskId !== null && <BrowserToggle taskId={taskId} />}
      <TerminalToggle terminalKey={taskId ?? draftKey} />
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
          tip={withShortcut(t("menu.toggleSidebar"), "Ctrl B")}
          testId="topbar-sidebar"
          expanded={props.sidebarShown}
          onClick={props.onToggleSidebar}
        >
          <SidebarIcon shown={props.sidebarShown} />
        </IconButton>
      </div>
      <TaskTabs />
      <TaskTools />
    </header>
  );
}
