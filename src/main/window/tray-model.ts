// 托盘的纯逻辑：提示文字里的任务计数和右键菜单模板。不 import electron，单元测试直接调用；
// 图标、点击和 Menu 对象由 tray.ts 接线。
import type { Locale, TaskId, TaskState } from "../../shared/ipc.ts";
import { t } from "../../shared/i18n/index.ts";

export interface TrayCounts {
  /** 在跑的：starting（正在拉起 omp）和 running。 */
  running: number;
  /** 等你确认的：needs_you。 */
  waiting: number;
}

type TrayTask = Pick<TaskState, "id" | "status" | "title">;

export function trayCounts(tasks: readonly Pick<TaskState, "status">[]): TrayCounts {
  const counts: TrayCounts = { running: 0, waiting: 0 };
  for (const task of tasks) {
    if (task.status === "running" || task.status === "starting") counts.running += 1;
    else if (task.status === "needs_you") counts.waiting += 1;
  }
  return counts;
}

/** 悬停提示：没有任务在忙时只有应用名，否则带上两个计数。 */
export function trayTooltip(locale: Locale, counts: TrayCounts): string {
  const name = t(locale, "notify.tray.name");
  if (counts.running === 0 && counts.waiting === 0) return name;
  return `${name} · ${t(locale, "notify.tray.summary", { ...counts })}`;
}

export interface TrayMenuItem {
  label?: string;
  type?: "separator";
  enabled?: boolean;
  click?: () => void;
}

export interface TrayActions {
  open(): void;
  focusTask(id: TaskId): void;
  quit(): void;
}

/** 菜单最多列出的忙碌任务数；再多的靠"打开"进窗口看。 */
export const trayTaskLimit = 6;

/** 右键菜单：打开 / 任务摘要（在忙的任务可点，点了定位到该任务）/ 退出。 */
export function trayMenuTemplate(locale: Locale, tasks: readonly TrayTask[], actions: TrayActions): TrayMenuItem[] {
  const counts = trayCounts(tasks);
  const busy = tasks.filter(
    (task) => task.status === "running" || task.status === "starting" || task.status === "needs_you",
  );
  const summary = busy.length === 0 ? t(locale, "notify.tray.idle") : t(locale, "notify.tray.summary", { ...counts });
  const items: TrayMenuItem[] = [
    { label: t(locale, "notify.tray.open"), click: actions.open },
    { type: "separator" },
    { label: summary, enabled: false },
  ];
  for (const task of busy.slice(0, trayTaskLimit)) {
    const key = task.status === "needs_you" ? "notify.tray.task.waiting" : "notify.tray.task.running";
    // 菜单标签里的 & 是快捷键标记，任务标题里的要转义。
    const title = (task.title || t(locale, "task.untitled")).replaceAll("&", "&&");
    items.push({ label: t(locale, key, { title }), click: () => actions.focusTask(task.id) });
  }
  items.push({ type: "separator" }, { label: t(locale, "notify.tray.quit"), click: actions.quit });
  return items;
}
