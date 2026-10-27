// 会话文件和 history.db 里 omp 恢复会话时不重发的内容（getTspSessionExtras）：每轮的用量脚注、最后一条空闲回顾，
// 还有最近一条回复的输出速度（工具行的速度）。
// 挂载时取一次，一轮结束（lastTurn 变）或新增一轮时再取。
// 组件按选择器取自己要的那一份（某一轮的脚注、速度）：新取回的内容里没变的轮沿用旧对象，那一轮的组件不重画。
import { useMemo, useSyncExternalStore } from "react";
import type { TaskId, TspSessionExtras } from "../../../../shared/ipc.ts";

const EMPTY: TspSessionExtras = { turns: [], tokensPerSecond: null };
const extras = new Map<TaskId, TspSessionExtras>();
const requests = new Map<TaskId, number>();
const listeners = new Map<TaskId, Set<() => void>>();

/** 新取回的轮里内容和旧的一样的沿用旧对象（每轮几项数字，按 JSON 比）；整份都没变返回旧的那份。 */
function share(previous: TspSessionExtras | undefined, next: TspSessionExtras): TspSessionExtras {
  if (previous === undefined) return next;
  let same = previous.tokensPerSecond === next.tokensPerSecond && previous.turns.length === next.turns.length;
  const turns = next.turns.map((turn, index) => {
    const old = previous.turns[index];
    if (old !== undefined && JSON.stringify(old) === JSON.stringify(turn)) return old;
    same = false;
    return turn;
  });
  return same ? previous : { ...next, turns };
}

export function refreshSessionExtras(taskId: TaskId): void {
  const request = (requests.get(taskId) ?? 0) + 1;
  requests.set(taskId, request);
  window.studio.getTspSessionExtras(taskId).then(
    (next) => {
      if (requests.get(taskId) !== request) return;
      const previous = extras.get(taskId);
      const shared = share(previous, next);
      if (shared === previous) return;
      extras.set(taskId, shared);
      for (const listener of listeners.get(taskId) ?? []) listener();
    },
    (error: unknown) => console.warn("getTspSessionExtras 失败", error),
  );
}

// 任务被移除：丢掉它的缓存；还在路上的请求回来时 requests 里已没有它，会被忽略。
window.studio.onTaskRemoved((taskId) => {
  extras.delete(taskId);
  requests.delete(taskId);
});

/** 取这个任务会话附加内容里的一份；select 的结果（Object.is）没变就不重画，所以要返回原值或基本类型，不要现拼对象。 */
export function useSessionExtras<T>(taskId: TaskId, select: (extras: TspSessionExtras) => T): T {
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
  return useSyncExternalStore(subscribe, () => select(extras.get(taskId) ?? EMPTY));
}
