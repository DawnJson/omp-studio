// 最近的可折叠祖先（card / section / tool / agent）的状态。规范 Layout/card "Previews inside"：
// 子节点自己的 preview（ansi、code、text……）只在折叠时生效，开着的折叠里它们让位、显示全部；没有可折叠祖先时照 preview 来。
import { createContext, useContext } from "react";

export interface FoldState {
  /** true = 折叠中（preview 生效）；false = 展开（全部显示）；null = 没有可折叠祖先（preview 生效，按钮本地展开）。 */
  collapsed: boolean | null;
  /** 折叠中点"N more lines"时展开祖先；没有就本地展开。 */
  expand?: (() => void) | undefined;
}

export const FoldCtx = createContext<FoldState>({ collapsed: null });

export function useFoldState(): FoldState {
  return useContext(FoldCtx);
}
