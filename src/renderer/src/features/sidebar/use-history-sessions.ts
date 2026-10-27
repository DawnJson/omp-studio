// 侧栏的"历史会话"：omp 会话目录里还没挂在任务上的会话（含终端里开的，只读 ~/.omp），按置顶、修改时间从新到旧。
// 已经挂在任务上的会话不再出现（它们就是任务行）。搜索过滤在 sidebar-model 里和任务一起做。
// 列表放在模块级 store 里，侧栏和命令面板共用一份：主进程每次 listSessions 都要扫一遍会话目录。
import { useEffect } from "react";
import type { SessionSummary } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { reportErrorNow } from "../../ui/errors.ts";

/** null = 还没取到过。 */
const store = createStore<readonly SessionSummary[] | null>(null);
const none: readonly SessionSummary[] = [];
/** 只认最后一次请求的结果：先发的请求晚回来时不覆盖新的。 */
let latest = 0;

function refreshHistorySessions(): void {
  const request = ++latest;
  window.studio.listSessions(null).then(
    (list) => {
      if (request !== latest) return;
      store.set(
        list
          .filter((session) => session.taskId === null)
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.modifiedAt - a.modifiedAt),
      );
    },
    (error: unknown) => reportErrorNow(error),
  );
}

/**
 * 侧栏用：refreshKey 变了就重取一次（侧栏传任务 id 列表：恢复了一个会话、或第一条消息建了任务，它的会话就该从历史里消失）；
 * 每次从"没在搜"进入"在搜"也重取：期间终端里可能新建了会话。
 */
export function useHistorySessions(searching: boolean, refreshKey: string): readonly SessionSummary[] {
  useEffect(() => refreshHistorySessions(), [searching, refreshKey]);
  return useStoreValue(store, (sessions) => sessions ?? none);
}

/** 命令面板用：沿用侧栏已经取到的列表，从没取过（侧栏没挂过）时才取一次。 */
export function useLoadedHistorySessions(): readonly SessionSummary[] {
  useEffect(() => {
    if (store.get() === null) refreshHistorySessions();
  }, []);
  return useStoreValue(store, (sessions) => sessions ?? none);
}
