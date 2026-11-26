// 回复里 ```svg 图的源码（getTspFigureSources）：omp 在 TSP 里只发它按自己主题栅格化的 PNG，这里按签名
// （shared/tsp/figures.ts）向主进程要源码，拿到了图节点就按 studio 的主题自己画。第一次用到时要一次；
// 还没要到的（回复还没写进会话文件）在一轮结束或新增一轮时再要（TspView 调 refreshFigures），要到了就不再要。
import { useMemo, useSyncExternalStore } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";

/** 签名 → 这段文字里的 svg 源码；null = 问过了还没有。 */
const sources = new Map<TaskId, Map<string, readonly string[] | null>>();
const inFlight = new Set<string>();
const listeners = new Map<TaskId, Set<() => void>>();

function request(taskId: TaskId, signature: string): void {
  const key = `${taskId}\u0001${signature}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  window.studio.getTspFigureSources(taskId, signature).then(
    (found) => {
      inFlight.delete(key);
      const known = sources.get(taskId);
      if (known === undefined || (found === null && known.get(signature) === null)) return;
      known.set(signature, found);
      for (const listener of listeners.get(taskId) ?? []) listener();
    },
    (error: unknown) => {
      inFlight.delete(key);
      console.warn("getTspFigureSources 失败", error);
    },
  );
}

/** 一轮结束或新增一轮：还没要到的再要一次。 */
export function refreshFigures(taskId: TaskId): void {
  for (const [signature, found] of sources.get(taskId) ?? []) if (found === null) request(taskId, signature);
}

window.studio.onTaskRemoved((taskId) => {
  sources.delete(taskId);
});

/** 非 hook 读取（放大查看时取兄弟图）：已经要到的源码，没有为 null。 */
export function peekFigureSource(taskId: TaskId, signature: string, ordinal: number): string | null {
  return sources.get(taskId)?.get(signature)?.[ordinal] ?? null;
}

/** 这段文字里第 `ordinal` 张图的 svg 源码；还没有、签名为 null（认不出图节点）时为 null。 */
export function useFigureSource(taskId: TaskId, signature: string | null, ordinal: number): string | null {
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
  return useSyncExternalStore(subscribe, () => {
    if (signature === null) return null;
    let known = sources.get(taskId);
    if (known === undefined) sources.set(taskId, (known = new Map()));
    if (!known.has(signature)) {
      known.set(signature, null);
      queueMicrotask(() => request(taskId, signature));
    }
    return known.get(signature)?.[ordinal] ?? null;
  });
}
