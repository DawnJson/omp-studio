// 任务行尾部的相对时间（spec §4.2）：纯函数，可单测。时钟（useNow）在渲染进程的 task-time.ts。
import type { TFunction } from "../i18n/index.ts";
import type { Locale, TaskState } from "../ipc.ts";

const minute = 60_000;
const hour = 60 * minute;

/**
 * 任务最后一次活动的时间：主进程持久化的 updatedAt，只在用户发消息和一轮结束时变
 * （选中、恢复、改名、迁移引擎、归档都不动它；历史会话建的任务取会话文件的修改时间）。
 */
export function lastActivityAt(task: Pick<TaskState, "updatedAt">): number {
  return task.updatedAt;
}

export function formatTaskTime(t: TFunction, locale: Locale, timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < minute) return t("time.now");
  if (elapsed < hour) return t("time.minutes", { n: Math.floor(elapsed / minute) });
  if (elapsed < 24 * hour) return t("time.hours", { n: Math.floor(elapsed / hour) });
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (timestamp >= today - 24 * hour && timestamp < today) return t("time.yesterday");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(timestamp);
}

/** 侧栏任务行的尾部文字；不显示尾部时是 null。运行中不满一分钟也不显示（状态点已经在转）。 */
export function taskTail(t: TFunction, locale: Locale, task: TaskState, now: number): string | null {
  if (task.status === "needs_you" || task.status === "starting") return null;
  if (task.status === "running") {
    const minutes = task.runStartedAt === null ? 0 : Math.floor((now - task.runStartedAt) / minute);
    return minutes < 1 ? null : t("task.runningFor", { n: minutes });
  }
  if (task.lastTurn?.status === "aborted") return t("task.stopped");
  return formatTaskTime(t, locale, lastActivityAt(task), now);
}
