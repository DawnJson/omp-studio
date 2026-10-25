// 顶栏右侧工具区的终端按钮（任务和新任务草稿都有）。按钮状态 = 面板是否打开。
import type { TerminalKey } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { withShortcut } from "../../app/platform-keys.ts";
import { Terminal } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { toggleTerminal } from "./terminal-actions.ts";
import { useTerminalOpen } from "./terminal-store.ts";

export function TerminalToggle({ terminalKey }: { terminalKey: TerminalKey }) {
  const t = useT();
  const open = useTerminalOpen(terminalKey);
  return (
    <IconButton
      label={t("terminal.toggle")}
      tip={withShortcut(t("terminal.toggle"), "Ctrl `")}
      pressed={open}
      expanded={open}
      testId="topbar-terminal"
      onClick={() => toggleTerminal(terminalKey)}
    >
      <Terminal size={16} />
    </IconButton>
  );
}
