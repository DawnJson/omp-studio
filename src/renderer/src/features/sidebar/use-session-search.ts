// 侧栏搜索的"历史会话"：搜索词非空时才向主进程要会话索引（含终端里的，只读 ~/.omp），按标题或首条消息过滤。
// 已经挂在任务上的会话不再出现（它们就是任务列表里的行）。
import { useEffect, useMemo, useState } from "react";
import type { SessionSummary } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";

export const sessionResultLimit = 20;

export const sessionLabel = (session: SessionSummary): string | null => session.title ?? session.firstPrompt;

export function useSessionSearch(query: string): SessionSummary[] {
  const t = useT();
  const active = query !== "";
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  // 每次从"没在搜"进入"在搜"都重取一次：期间终端里可能新建了会话。
  useEffect(() => {
    if (!active) return;
    let current = true;
    window.studio.listSessions(null).then(
      (list) => current && setSessions(list.filter((session) => session.taskId === null)),
      (error: unknown) => reportError(t, error),
    );
    return () => {
      current = false;
    };
  }, [active, t]);
  return useMemo(() => {
    if (!active) return [];
    const needle = query.toLowerCase();
    return sessions
      .filter((session) => (sessionLabel(session) ?? "").toLowerCase().includes(needle))
      .slice(0, sessionResultLimit);
  }, [active, query, sessions]);
}
