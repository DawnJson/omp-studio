// 侧栏的"历史会话"：omp 会话目录里还没挂在任务上的会话（含终端里开的，只读 ~/.omp），按修改时间从新到旧。
// 已经挂在任务上的会话不再出现（它们就是任务行）。搜索过滤在 sidebar-model 里和任务一起做。
import { useEffect, useState } from "react";
import type { SessionSummary } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";

/**
 * refreshKey 变了就重取一次（侧栏传任务 id 列表：恢复了一个会话、或第一条消息建了任务，它的会话就该从历史里消失）；
 * 每次从"没在搜"进入"在搜"也重取：期间终端里可能新建了会话。
 */
export function useHistorySessions(searching: boolean, refreshKey: string): SessionSummary[] {
  const t = useT();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  useEffect(() => {
    let current = true;
    window.studio.listSessions(null).then(
      (list) =>
        current &&
        setSessions(list.filter((session) => session.taskId === null).sort((a, b) => b.modifiedAt - a.modifiedAt)),
      (error: unknown) => reportError(t, error),
    );
    return () => {
      current = false;
    };
  }, [searching, refreshKey, t]);
  return sessions;
}
