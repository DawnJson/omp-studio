// 输入框工具行上次读到的数据（主进程的启动缓存，StartupSnapshot）：渲染前读一次，工具行第一帧就用它画完整，
// 现读的结果到了再替换。只做显示用初值；之后的变化都走各自的现读和事件，这里不再更新。
import type { StartupSnapshot } from "../../../shared/ipc.ts";

let snapshot: StartupSnapshot = {};

/** main.tsx 在渲染前调用；读不到就当没有（工具行照旧等现读）。 */
export async function loadStartupSnapshot(): Promise<void> {
  try {
    snapshot = await window.studio.getStartupSnapshot();
  } catch {
    snapshot = {};
  }
}

export function startupSnapshot(): StartupSnapshot {
  return snapshot;
}
