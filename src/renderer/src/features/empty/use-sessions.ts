// "继续"列表的数据：listSessions（只读 ~/.omp）。任务列表变化后重取，"来自终端"的标记才准；失败时给出 error 和重试。
import { useCallback, useEffect, useState } from "react";
import type { Project, SessionSummary } from "../../../../shared/ipc.ts";
import { useTasks } from "../../store/index.ts";

export const continueLimit = 5;

export interface SessionsState {
  sessions: SessionSummary[];
  error: unknown;
  retry(): void;
}

export function useSessions(project: Project | null): SessionsState {
  const tasks = useTasks();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const projectId = project?.id ?? null;
  const taskCount = tasks.length;
  useEffect(() => {
    let current = true;
    window.studio.listSessions(projectId).then(
      (list) => {
        if (!current) return;
        setError(null);
        setSessions(list.slice(0, continueLimit));
      },
      (cause: unknown) => {
        if (current) setError(cause);
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, taskCount, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { sessions, error, retry };
}
