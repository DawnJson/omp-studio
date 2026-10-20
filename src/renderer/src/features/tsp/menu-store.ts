// 节点 `actions.menu` 的右键菜单：同一时间只有一个；TspView 里的 TspMenuHost 负责画。
import { createStore, useStoreValue } from "../../store/create-store.ts";

export interface TspMenuItem {
  /** 动作名（显示时去掉分隔符）。 */
  act: string;
  run(): void;
}

export interface TspMenuState {
  x: number;
  y: number;
  items: readonly TspMenuItem[];
}

const menu = createStore<TspMenuState | null>(null);

export function showTspMenu(at: { x: number; y: number }, items: readonly TspMenuItem[]): void {
  menu.set({ x: at.x, y: at.y, items });
}

export function hideTspMenu(): void {
  menu.set(null);
}

export function useTspMenu(): TspMenuState | null {
  return useStoreValue(menu, (state) => state);
}
