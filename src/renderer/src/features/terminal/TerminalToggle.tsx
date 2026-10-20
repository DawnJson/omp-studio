// 顶栏右侧工具区的终端按钮（任务和新任务草稿都有）。按钮状态 = 面板是否打开。
import type { TerminalKey } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Terminal } from "../../icons.tsx";
import { toggleTerminal } from "./terminal-actions.ts";
import { useTerminalOpen } from "./terminal-store.ts";

export function TerminalToggle({ terminalKey }: { terminalKey: TerminalKey }) {
  const t = useT();
  const open = useTerminalOpen(terminalKey);
  return (
    <button
      type="button"
      className="topbar-tool"
      data-testid="topbar-terminal"
      aria-label={t("terminal.toggle")}
      aria-pressed={open}
      aria-expanded={open}
      title={`${t("terminal.toggle")} (Ctrl \`)`}
      onClick={() => toggleTerminal(terminalKey)}
    >
      <Terminal size={16} />
    </button>
  );
}
