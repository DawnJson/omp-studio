// 任务行相对时间用的时钟：所有行共用一个（15 秒一跳，够让"刚刚"在一分钟内翻成"1 分钟"）。
// 格式化和"最后活动时间"是纯函数，在 shared/ui/task-time.ts。
import { createStore, useStoreValue } from "../../store/create-store.ts";

const clock = createStore<number>(Date.now());
// 模块加载时就开始走，首次渲染拿到的"现在"最多旧 15 秒（格式化时负的经过时间按 0 算）。
window.setInterval(() => clock.set(Date.now()), 15_000);

/** 每 15 秒更新一次的"现在"。 */
export function useNow(): number {
  return useStoreValue(clock, (state) => state);
}
