// 节点 `actions.menu` 的右键菜单：同一时间只有一个；TspView 里的 TspMenuHost 负责画。
import { createStore, useStoreValue } from "../../store/create-store.ts";
import type { ContextRow, MenuHeader, MenuSeparator } from "./nodes/menu-model.ts";

/** 菜单里的一行（omp 给的项见 menu-model.ts 的 ContextRow；studio 自己加的项 label 已翻译）。 */
export interface TspMenuRow extends ContextRow {
  run(): void;
}

export type TspMenuEntry = MenuSeparator | MenuHeader | TspMenuRow;

export interface TspMenuState {
  x: number;
  y: number;
  items: readonly TspMenuEntry[];
}

const menu = createStore<TspMenuState | null>(null);

export function showTspMenu(at: { x: number; y: number }, items: readonly TspMenuEntry[]): void {
  menu.set({ x: at.x, y: at.y, items });
}

export function hideTspMenu(): void {
  menu.set(null);
}

export function useTspMenu(): TspMenuState | null {
  return useStoreValue(menu, (state) => state);
}
