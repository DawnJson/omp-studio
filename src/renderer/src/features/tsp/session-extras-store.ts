// 会话文件和 history.db 里 omp 恢复会话时不重发的内容（getTspSessionExtras）：每轮的用量脚注、最后一条空闲回顾，
// 还有最近一条回复的输出速度（工具行的速度）和上下文构成（圆环浮层的系统提示词 / 工具定义行）。
// 挂载时取一次，一轮结束（lastTurn 变）或新增一轮时再取。
import { useMemo, useSyncExternalStore } from "react";
import type { TaskId, TspSessionExtras } from "../../../../shared/ipc.ts";

const EMPTY: TspSessionExtras = { turns: [], recap: null, tokensPerSecond: null, contextParts: null };
const extras = new Map<TaskId, TspSessionExtras>();
const requests = new Map<TaskId, number>();
const listeners = new Map<TaskId, Set<() => void>>();

export function refreshSessionExtras(taskId: TaskId): void {
  const request = (requests.get(taskId) ?? 0) + 1;
  requests.set(taskId, request);
  window.studio.getTspSessionExtras(taskId).then(
    (next) => {
      if (requests.get(taskId) !== request) return;
      extras.set(taskId, next);
      for (const listener of listeners.get(taskId) ?? []) listener();
    },
    (error: unknown) => console.warn("getTspSessionExtras 失败", error),
  );
}

export function useSessionExtras(taskId: TaskId): TspSessionExtras {
  const subscribe = useMemo(
    () => (listener: () => void) => {
      let set = listeners.get(taskId);
      if (!set) listeners.set(taskId, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(taskId);
      };
    },
    [taskId],
  );
  return useSyncExternalStore(subscribe, () => extras.get(taskId) ?? EMPTY);
}
