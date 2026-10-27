// 任务行相对时间用的时钟：所有行共用一个（15 秒一跳，够让"刚刚"在一分钟内翻成"1 分钟"）。
// 格式化和"最后活动时间"是纯函数，在 shared/ui/task-time.ts。
// 和 conversation/use-now.ts 的整秒时钟（useNow）不是一回事：这里是粗粒度的共享时钟，所以叫 useCoarse*。
import { createStore, useStoreValue } from "../../store/create-store.ts";

const clock = createStore<number>(Date.now());
// 模块加载时就开始走，首次渲染拿到的"现在"最多旧 15 秒（格式化时负的经过时间按 0 算）。
window.setInterval(() => clock.set(Date.now()), 15_000);

/** 每 15 秒更新一次的"现在"。 */
export function useCoarseNow(): number {
  return useStoreValue(clock, (now) => now);
}

/**
 * 从时钟算出一个值（如任务行尾部的"5 分钟"），只在算出的值变了时重渲染：
 * 时钟一跳，只有文字真的变了的行重画。select 要返回原始值（字符串 / 数字 / null）。
 */
export function useCoarseClock<S extends string | number | boolean | null>(select: (now: number) => S): S {
  return useStoreValue(clock, select);
}
