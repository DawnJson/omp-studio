// 侧栏的"历史会话"：omp 会话目录里还没挂在任务上的会话（含终端里开的，只读 ~/.omp）。
// 不搜索时按修改时间从新到旧全部给出（侧栏只显示前几条，可以"显示更多"）；搜索时按标题或首条消息过滤，最多 20 条。
// 已经挂在任务上的会话不再出现（它们就是任务列表里的行）。
import { useEffect, useMemo, useState } from "react";
import type { SessionSummary } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";

export const sessionResultLimit = 20;

export const sessionLabel = (session: SessionSummary): string | null => session.title ?? session.firstPrompt;

/**
 * refreshKey 变了就重取一次（侧栏传任务 id 列表：恢复了一个会话、或第一条消息建了任务，它的会话就该从历史里消失）；
 * 每次从"没在搜"进入"在搜"也重取：期间终端里可能新建了会话。
 */
export function useHistorySessions(query: string, refreshKey: string): SessionSummary[] {
  const t = useT();
  const searching = query !== "";
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
  return useMemo(() => {
    if (!searching) return sessions;
    const needle = query.toLowerCase();
    return sessions
      .filter((session) => (sessionLabel(session) ?? "").toLowerCase().includes(needle))
      .slice(0, sessionResultLimit);
  }, [searching, query, sessions]);
}
