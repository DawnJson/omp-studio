// 终端的焦点和显隐动作：快捷键 Ctrl+` 和命令面板/顶栏按钮的语义不同，都在这里。
import { useEffect, useRef } from "react";
import type { DraftKey, TaskId, TerminalKey } from "../../../../shared/ipc.ts";
import { isTerminalOpen, rekeyTerminalOpen, setTerminalOpen } from "./terminal-store.ts";

/** 草稿正在建任务并交接终端：这段时间里草稿的键可能因项目列表刷新而变，不能因此把终端关了。 */
let handoverActive = false;

/**
 * 草稿建出任务后，让草稿的终端（shell、backlog、打开状态）变成任务的终端；`worktree` 为真时任务目录是新建的
 * worktree，和草稿终端的目录不同，直接关掉草稿的终端，任务的面板重新起。放在 selectTask 之前调用。
 * 终端相关的失败不挡发送：记一笔，任务的面板自己会重新起。
 */
export async function handOverDraftTerminal(from: DraftKey, to: TaskId, worktree: boolean): Promise<void> {
  try {
    if (worktree) {
      await window.studio.closeTerminal(from);
      setTerminalOpen(from, false);
      return;
    }
    await window.studio.rekeyTerminal(from, to);
    rekeyTerminalOpen(from, to);
  } catch (error) {
    console.error("草稿终端交接失败", error);
    setTerminalOpen(from, false);
  }
}

/** 包住"建任务 + 交接终端"：这期间 useDraftTerminalCleanup 不关草稿的终端。 */
export async function withDraftHandover<T>(run: () => Promise<T>): Promise<T> {
  handoverActive = true;
  try {
    return await run();
  } finally {
    handoverActive = false;
  }
}

/** 草稿换了项目（键变了）：关掉上一个草稿的终端，它的目录属于上一个项目。 */
export function useDraftTerminalCleanup(key: DraftKey): void {
  const previous = useRef(key);
  useEffect(() => {
    const old = previous.current;
    previous.current = key;
    if (old === key || handoverActive) return;
    setTerminalOpen(old, false);
    void window.studio.closeTerminal(old).catch(() => undefined);
  }, [key]);
}

const hostSelector = "[data-terminal-host]";
const composerSelector = "[data-composer-input]";

/** 焦点是否在终端里（xterm 的隐藏输入框在 host 内）。 */
function terminalHasFocus(): boolean {
  return document.activeElement?.closest(hostSelector) != null;
}

function focusTerminal(): void {
  document.querySelector<HTMLTextAreaElement>(`${hostSelector} textarea`)?.focus({ preventScroll: true });
}

/** 顶栏按钮、命令面板：纯切换显隐。打开时焦点进终端。 */
export function toggleTerminal(key: TerminalKey): void {
  const open = isTerminalOpen(key);
  setTerminalOpen(key, !open, { focus: !open });
  if (open && terminalHasFocus()) document.querySelector<HTMLElement>(composerSelector)?.focus({ preventScroll: true });
}

/**
 * Ctrl+`：收起 → 打开并聚焦终端；开着且焦点不在终端 → 聚焦终端；焦点已在终端 → 收起并回到输入框。
 * （终端聚焦时 Ctrl 组合键归 shell，所以回到输入框的出口只有它。）
 */
export function toggleTerminalFocus(key: TerminalKey): void {
  if (!isTerminalOpen(key)) {
    setTerminalOpen(key, true, { focus: true });
  } else if (terminalHasFocus()) {
    setTerminalOpen(key, false);
    document.querySelector<HTMLElement>(composerSelector)?.focus({ preventScroll: true });
  } else {
    focusTerminal();
  }
}
