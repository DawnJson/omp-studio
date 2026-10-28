// 当前 surface 的渲染上下文：TspView 提供，TspChildren 把它当 props 往下传；
// 不接收 ctx props 的地方（跨节点的小组件，如 TspSpans 里的链接）用这个 hook 取。
import { createContext, useContext } from "react";
import type { TspContext } from "./node-props.ts";

export const TspCtx = createContext<TspContext | null>(null);

export function useTspContext(): TspContext | null {
  return useContext(TspCtx);
}

/** 设置页盖着这个过程区（TspView 的 parked）：节点还挂着，omp 的弹层不截 Esc、通知不弹。 */
export const TspParkedCtx = createContext(false);

export function useTspParked(): boolean {
  return useContext(TspParkedCtx);
}

/**
 * 任务的 omp 进程不在了（stopped / error）的时刻；进程还在为 null。留着的最后一份文档照样画，但里面不再有东西在跑：
 * 没人再更新这些卡片，Windows 上进程的 Job 一关，它起的进程（含后台作业）也一起结束。
 * 所以计时停在这一刻（use-clock.ts），循环动画暂停（`.tsp-view[data-ended]`），运行中的工具卡、子代理行画成已中断（nodes/work.tsx）。
 */
export const TspEndedAtCtx = createContext<number | null>(null);

export function useTspEnded(): boolean {
  return useContext(TspEndedAtCtx) !== null;
}
