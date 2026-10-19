// 正在跑的 `!命令`（按任务）。omp 的 bash 命令只在跑完时应答、中途没有事件，所以"正在运行"只能由发起方（输入框）记。
// 跑完后的命令块来自对话流里的 bashExecution 消息（model.ts），这里只管运行期间的那一行。
import { useSyncExternalStore } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";

export interface ShellRun {
  command: string;
  startedAt: number;
}

const runs = new Map<TaskId, ShellRun>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function startShellRun(taskId: TaskId, command: string): void {
  runs.set(taskId, { command, startedAt: Date.now() });
  emit();
}

export function endShellRun(taskId: TaskId): void {
  if (runs.delete(taskId)) emit();
}

export function getShellRun(taskId: TaskId): ShellRun | null {
  return runs.get(taskId) ?? null;
}

export function useShellRun(taskId: TaskId): ShellRun | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => runs.get(taskId) ?? null,
  );
}
