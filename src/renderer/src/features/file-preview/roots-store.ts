// 文件面板当前看哪个根：0 = 任务目录，n = 第 n 个额外工作区目录（`TaskState.workspaceDirs`）。
// 只存下标；绝对路径在主进程（file-handlers 按下标取）。按任务记，面板关了再开、切走任务再回来仍在。
import type { TerminalKey } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

const store = createStore<ReadonlyMap<TerminalKey, number>>(new Map());

export function selectedRoot(key: TerminalKey): number {
  return store.get().get(key) ?? 0;
}

export function selectRoot(key: TerminalKey, root: number): void {
  if (selectedRoot(key) === root) return;
  const next = new Map(store.get());
  if (root === 0) next.delete(key);
  else next.set(key, root);
  store.set(next);
}

export function useSelectedRoot(key: TerminalKey): number {
  return useStoreValue(store, (state) => state.get(key) ?? 0);
}

/** 树的记忆（展开、光标、滚动）按根分开：同一个任务的不同根各记各的。 */
export function rootMemoryKey(key: TerminalKey, root: number): TerminalKey {
  return (root === 0 ? key : `${key}\u0000root${root}`) as TerminalKey;
}

// 刚加进来、列表还没到的根：IPC 应答可能先于 taskState 事件到达，文件面板等 `workspaceDirs` 长到够了再选中，
// 否则它会把还不存在的根当成过期下标放回任务目录。
const pending = createStore<ReadonlyMap<TerminalKey, number>>(new Map());

export function selectRootWhenListed(key: TerminalKey, root: number): void {
  pending.set(new Map(pending.get()).set(key, root));
}

export function usePendingRoot(key: TerminalKey): number | undefined {
  return useStoreValue(pending, (state) => state.get(key));
}

export function clearPendingRoot(key: TerminalKey): void {
  const next = new Map(pending.get());
  if (next.delete(key)) pending.set(next);
}

if (typeof window !== "undefined" && "studio" in window) {
  window.studio.onTaskRemoved((taskId) => {
    for (const target of [store, pending]) {
      const next = new Map(target.get());
      if (next.delete(taskId as string as TerminalKey)) target.set(next);
    }
  });
}
