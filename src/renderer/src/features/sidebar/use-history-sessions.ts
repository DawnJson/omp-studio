// 侧栏的"历史会话"：omp 会话目录里的全部会话（含终端里开的，只读 ~/.omp），按置顶、修改时间从新到旧。
// 挂在任务上的、已归档的也留着（sidebar-model 用它们查任务行的分叉关系、列"已归档"）；哪些单列一行见 isListedSession。
// 搜索过滤在 sidebar-model 里和任务一起做。
// 列表放在模块级 store 里，侧栏和命令面板共用一份：主进程每次 listSessions 都要扫一遍会话目录。
import { useEffect } from "react";
import type { SessionSummary, TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { reportErrorNow } from "../../ui/errors.ts";

/** null = 还没取到过。 */
const store = createStore<readonly SessionSummary[] | null>(null);
const none: readonly SessionSummary[] = [];
/** 只认最后一次请求的结果：先发的请求晚回来时不覆盖新的。 */
let latest = 0;

/** 重取一次；归档、恢复历史会话之后调用。 */
export function refreshHistorySessions(): void {
  const request = ++latest;
  window.studio.listSessions(null).then(
    (list) => {
      if (request !== latest) return;
      store.set([...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.modifiedAt - a.modifiedAt));
    },
    (error: unknown) => reportErrorNow(error),
  );
}

/**
 * 侧栏用：refreshKey 变了就重取一次（侧栏传任务 id 列表：恢复了一个会话、或第一条消息建了任务，它的会话就该从历史里消失）；
 * 每次从"没在搜"进入"在搜"、窗口重新获得焦点时也重取：期间终端里可能新建或删掉了会话（issue #8）。
 */
export function useHistorySessions(searching: boolean, refreshKey: string): readonly SessionSummary[] {
  useEffect(() => refreshHistorySessions(), [searching, refreshKey]);
  useEffect(() => {
    window.addEventListener("focus", refreshHistorySessions);
    return () => window.removeEventListener("focus", refreshHistorySessions);
  }, []);
  return useStoreValue(store, (sessions) => sessions ?? none);
}

/** 命令面板用：先用已经取到的列表，每次打开再重取一次。 */
export function useLoadedHistorySessions(): readonly SessionSummary[] {
  useEffect(() => refreshHistorySessions(), []);
  return useStoreValue(store, (sessions) => sessions ?? none);
}

/** 已经取到过一次历史会话：之前文件夹列表里还缺只在历史里出现的目录，不能拿来记"新文件夹"。 */
export function useHistorySessionsLoaded(): boolean {
  return useStoreValue(store, (sessions) => sessions !== null);
}

/** 任务挂着的会话是否置顶（omp `/pin`）：按已经取到的列表算，不重取。 */
function pinnedOf(sessions: readonly SessionSummary[] | null, taskId: TaskId): boolean {
  return sessions?.some((session) => session.taskId === taskId && session.pinned) === true;
}

/** 打开菜单的那一刻用（侧栏任务行）。 */
export function isTaskPinned(taskId: TaskId): boolean {
  return pinnedOf(store.get(), taskId);
}

/** 顶栏 ⋯ 用：列表刷新后跟着变。 */
export function useTaskPinned(taskId: TaskId): boolean {
  return useStoreValue(store, (sessions) => pinnedOf(sessions, taskId));
}
