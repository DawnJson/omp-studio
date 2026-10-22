// 设置页页头右侧的槽（标题同一行靠右）：各节把"范围"下拉、"连接提供商…"这类 sm 控件放进去。
// SettingsView 提供槽元素（PageHeadSlot），节里写 <PageHeadActions>…</PageHeadActions>，内容 portal 到槽里。
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SlotContext = createContext<HTMLElement | null>(null);

export const PageHeadSlot = SlotContext.Provider;

export function PageHeadActions({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  return slot === null ? null : createPortal(children, slot);
}
