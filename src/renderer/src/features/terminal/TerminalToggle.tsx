// 任务条右侧工具区的终端按钮（顶栏只在有任务的对话页渲染它：草稿没有目录可开）。按钮状态 = 面板是否打开。
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Terminal } from "../../icons.tsx";
import { toggleTerminal } from "./terminal-actions.ts";
import { useTerminalOpen } from "./terminal-store.ts";

export function TerminalToggle({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const open = useTerminalOpen(taskId);
  return (
    <button
      type="button"
      className="topbar-tool"
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
