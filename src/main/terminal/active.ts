// 当前的终端管理器（有终端之后才存在）。任务池只需要"结束某个任务的终端"，经这里取，
// 不直接 import terminal/runtime.ts（它要 import 任务池，会成环）。
import type { TaskId } from "../../shared/ipc.ts";
import type { TerminalManager } from "./terminal-manager.ts";

let active: TerminalManager | null = null;

export function setActiveTerminalManager(manager: TerminalManager): void {
  active = manager;
}

/** 任务归档或 worktree 被丢弃前调用：进程占着目录的话 Windows 上删不掉。管理器还没创建过就没有终端。 */
export function closeTaskTerminal(taskId: TaskId): Promise<void> {
  return active?.close(taskId) ?? Promise.resolve();
}
