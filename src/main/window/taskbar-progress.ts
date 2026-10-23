// 任务栏图标上的进度：有任务在跑（status running）时 Windows 任务栏显示不定进度（流动条），全部空闲时清除。
// 不读 omp 的 OSC 9;4：它是每个 omp 进程各发各的（一轮运行时亮、结束时灭），要把多个任务合成"任一个在跑"
// 还得自己聚合，而 TaskState.status 已经是这个聚合的输入（且 7501 / 节点 / loader 都算进去了），所以直接按任务状态算。
// 等你确认（needs_you）的任务不算在跑：用户要去操作它，流动条会误导。runtime.ts 的 state 事件调用 refreshTaskbarProgress。
import type { BrowserWindow } from "electron";
import type { TaskState } from "../../shared/ipc.ts";

let window: BrowserWindow | null = null;
let busy = false;

/** 任务栏进度模式：有任务在跑是不定进度，否则清除。纯函数。 */
export function taskbarProgressMode(tasks: readonly Pick<TaskState, "status">[]): "indeterminate" | "none" {
  return tasks.some((task) => task.status === "running") ? "indeterminate" : "none";
}

function apply(): void {
  if (window === null || window.isDestroyed()) return;
  if (busy) window.setProgressBar(2, { mode: "indeterminate" });
  else window.setProgressBar(-1);
}

/** 主窗口创建时登记（窗口关了再开，进度按当前任务状态补上）。 */
export function attachTaskbarWindow(next: BrowserWindow): void {
  window = next;
  next.once("closed", () => {
    if (window === next) window = null;
  });
  apply();
}

/** 任务状态变了：按最新的任务列表更新任务栏进度（只在忙闲变化时才动系统）。 */
export function refreshTaskbarProgress(tasks: readonly Pick<TaskState, "status">[]): void {
  const next = taskbarProgressMode(tasks) === "indeterminate";
  if (next === busy) return;
  busy = next;
  apply();
}
