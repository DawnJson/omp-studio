// 终端的焦点和显隐动作：快捷键 Ctrl+` 和命令面板/顶栏按钮的语义不同，都在这里。
import type { TaskId } from "../../../../shared/ipc.ts";
import { isTerminalOpen, setTerminalOpen } from "./terminal-store.ts";

const hostSelector = "[data-terminal-host]";
const composerSelector = "[data-composer-input]";

/** 焦点是否在终端里（xterm 的隐藏输入框在 host 内）。 */
export function terminalHasFocus(): boolean {
  return document.activeElement?.closest(hostSelector) != null;
}

export function focusTerminal(): void {
  document.querySelector<HTMLTextAreaElement>(`${hostSelector} textarea`)?.focus({ preventScroll: true });
}

/** 顶栏按钮、命令面板：纯切换显隐。打开时焦点进终端。 */
export function toggleTerminal(taskId: TaskId): void {
  const open = isTerminalOpen(taskId);
  setTerminalOpen(taskId, !open, { focus: !open });
  if (open && terminalHasFocus()) document.querySelector<HTMLElement>(composerSelector)?.focus({ preventScroll: true });
}

/**
 * Ctrl+`：收起 → 打开并聚焦终端；开着且焦点不在终端 → 聚焦终端；焦点已在终端 → 收起并回到输入框。
 * （终端聚焦时 Ctrl 组合键归 shell，所以回到输入框的出口只有它。）
 */
export function toggleTerminalFocus(taskId: TaskId): void {
  if (!isTerminalOpen(taskId)) {
    setTerminalOpen(taskId, true, { focus: true });
  } else if (terminalHasFocus()) {
    setTerminalOpen(taskId, false);
    document.querySelector<HTMLElement>(composerSelector)?.focus({ preventScroll: true });
  } else {
    focusTerminal();
  }
}
