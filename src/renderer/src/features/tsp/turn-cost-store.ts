// 每轮的准确费用（getTspTurnCosts：从 omp 会话文件算，从旧到新）。挂载时取一次，一轮结束（lastTurn 变）再取。
import { useMemo, useSyncExternalStore } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";

const EMPTY: readonly number[] = [];
const costs = new Map<TaskId, readonly number[]>();
const requests = new Map<TaskId, number>();
const listeners = new Map<TaskId, Set<() => void>>();

export function refreshTurnCosts(taskId: TaskId): void {
  const request = (requests.get(taskId) ?? 0) + 1;
  requests.set(taskId, request);
  window.studio.getTspTurnCosts(taskId).then(
    (next) => {
      if (requests.get(taskId) !== request) return;
      costs.set(taskId, next);
      for (const listener of listeners.get(taskId) ?? []) listener();
    },
    (error: unknown) => console.warn("getTspTurnCosts 失败", error),
  );
}

export function useTurnCosts(taskId: TaskId): readonly number[] {
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
  return useSyncExternalStore(subscribe, () => costs.get(taskId) ?? EMPTY);
}
