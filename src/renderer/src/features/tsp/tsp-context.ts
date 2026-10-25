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
