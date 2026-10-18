// 任务条右侧的终端按钮：只在有任务的对话页显示（草稿没有目录可开）。按钮状态 = 面板是否打开。
import { useT } from "../../i18n/use-t.ts";
import { Terminal } from "../../icons.tsx";
import { useMainView, useSelectedTaskId, useTask } from "../../store/index.ts";
import { toggleTerminal } from "./terminal-actions.ts";
import { useTerminalOpen } from "./terminal-store.ts";

export function TerminalToggle() {
  const t = useT();
  const view = useMainView();
  const taskId = useSelectedTaskId();
  const task = useTask(taskId);
  const open = useTerminalOpen(taskId);
  if (view !== "conversation" || taskId === null || task === null) return null;
  return (
    <button
      type="button"
      className="icon-button topbar-terminal"
      data-testid="topbar-terminal"
      aria-label={t("terminal.toggle")}
      aria-pressed={open}
      aria-expanded={open}
      title={`${t("terminal.toggle")} (Ctrl \`)`}
      onClick={() => toggleTerminal(taskId)}
    >
      <Terminal size={16} />
    </button>
  );
}
