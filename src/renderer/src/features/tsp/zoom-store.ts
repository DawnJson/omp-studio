// image 节点的 zoom 动作（规范 Data/image "Zoom"）：点一张图在大图查看器里看，同一个父节点下的其它 blob 图可以左右翻。
import { createStore, useStoreValue } from "../../store/create-store.ts";

export interface ZoomItem {
  src: string;
  alt: string;
}

export interface ZoomState {
  items: readonly ZoomItem[];
  index: number;
}

const zoom = createStore<ZoomState | null>(null);

export function openZoom(items: readonly ZoomItem[], index: number): void {
  if (items.length > 0) zoom.set({ items, index: Math.min(Math.max(index, 0), items.length - 1) });
}

export function stepZoom(delta: number): void {
  const state = zoom.get();
  if (!state) return;
  zoom.set({ ...state, index: (state.index + delta + state.items.length) % state.items.length });
}

export function closeZoom(): void {
  zoom.set(null);
}

export function useZoom(): ZoomState | null {
  return useStoreValue(zoom, (state) => state);
}
