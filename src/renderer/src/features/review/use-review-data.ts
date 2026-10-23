// 评审的数据：git 状态和当前文件的 diff。主进程是权威，这里只取、不缓存第二份：
// 状态在 挂载、窗口重新聚焦、任务状态变化（agent 刚改完文件）、手动刷新、每次操作之后重新取；diff 随每次状态刷新重取。
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitDiffArea, GitDiffContext, GitFileDiff, GitStatus } from "../../../../shared/git.ts";
import type { TaskId, TaskState } from "../../../../shared/ipc.ts";
import { indexStats, type LineCounts } from "../../../../shared/ui/review-model.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";

export interface ReviewStatus {
  status: GitStatus | null;
  error: unknown;
  /** 每次状态应答 +1：diff 据此重取。 */
  stamp: number;
  refresh(): void;
}

export function useReviewStatus(taskId: TaskId, taskStatus: TaskState["status"] | undefined): ReviewStatus {
  const [state, setState] = useState<{ status: GitStatus | null; error: unknown; stamp: number }>({
    status: null,
    error: null,
    stamp: 0,
  });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let current = true;
    window.studio.getGitStatus(taskId).then(
      (status) => current && setState((s) => ({ status, error: null, stamp: s.stamp + 1 })),
      (error: unknown) => current && setState((s) => ({ ...s, error, stamp: s.stamp + 1 })),
    );
    return () => {
      current = false;
    };
  }, [taskId, tick, taskStatus]);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  return { ...state, refresh };
}

export interface FileDiffState {
  /** 已经取到的那份 diff 属于哪个文件/哪一侧/哪种视图；和当前选中的不一致时界面显示"加载中"。 */
  key: string | null;
  diff: GitFileDiff | null;
  error: unknown;
}

/** diff 状态的键：一份 diff 属于哪个文件 / 哪一侧 / 哪种视图 / 是否忽略空白。 */
export function diffKeyOf(area: GitDiffArea, scope: GitDiffContext, ignoreWhitespace: boolean, path: string): string {
  return `${area}:${scope}:${ignoreWhitespace ? "w" : "-"}:${path}`;
}

export function useFileDiff(
  taskId: TaskId,
  target: { path: string; area: GitDiffArea } | null,
  scope: GitDiffContext,
  ignoreWhitespace: boolean,
  stamp: number,
): FileDiffState {
  const [state, setState] = useState<FileDiffState>({ key: null, diff: null, error: null });
  const path = target?.path ?? null;
  const area = target?.area ?? null;
  const latest = useRef(0);

  useEffect(() => {
    if (path === null || area === null) return;
    const key = diffKeyOf(area, scope, ignoreWhitespace, path);
    const request = ++latest.current;
    window.studio.getGitFileDiff(taskId, path, area, scope, ignoreWhitespace).then(
      (diff) => request === latest.current && setState({ key, diff, error: null }),
      (error: unknown) => request === latest.current && setState({ key, diff: null, error }),
    );
  }, [taskId, path, area, scope, ignoreWhitespace, stamp]);

  return state;
}

/** 文件树每行的 `+a −d`：随状态一起重取（stamp），取不到时保留上一份、报错（不吞）。 */
export function useChangeStats(taskId: TaskId, stamp: number): ReadonlyMap<string, LineCounts> {
  const t = useT();
  const [stats, setStats] = useState<ReadonlyMap<string, LineCounts>>(new Map());
  useEffect(() => {
    if (stamp === 0) return;
    let current = true;
    window.studio.getGitChangeStats(taskId).then(
      (list) => current && setStats(indexStats(list)),
      (error: unknown) => current && reportError(t, error),
    );
    return () => {
      current = false;
    };
  }, [taskId, stamp, t]);
  return stats;
}
