// image 节点的 zoom 动作（规范 Data/image "Zoom"）：点一张图在大图查看器里看，同一个父节点下的其它 blob 图可以左右翻。
// 打开 / 关闭用 View Transitions：缩略图和大图临时共用 `view-transition-name`，大图从缩略图位置长出来、关时缩回去
// （样式在 tsp.css 的 `::view-transition-*(tsp-zoom)`；整窗淡入淡出沿用 root 的快照，时长只对这一次生效）。
import { flushSync } from "react-dom";
import { createStore, useStoreValue } from "../../store/create-store.ts";

export interface ZoomItem {
  src: string;
  alt: string;
  /** 缩略图所在 image 节点的 id（`.tsp-image[data-id]`）；没有就找不到缩略图，开合只淡入淡出。 */
  id?: string;
}

export interface ZoomState {
  items: readonly ZoomItem[];
  index: number;
}

const zoom = createStore<ZoomState | null>(null);

const groupName = "tsp-zoom";
const markAttr = "data-tsp-zoom-vt";
/** 起了名的缩略图 / 大图；和根上的 markAttr 分开，清名字时不能把根上的标记一起清掉（新状态的伪元素样式靠它）。 */
const namedAttr = "data-tsp-zoom-named";
const largeSelector = ".tsp-zoom img";
let generation = 0;

/** 这一项在对话里的缩略图；卸载了或已滚出视口就是 null。 */
function thumbnailOf(item: ZoomItem | undefined): HTMLElement | null {
  if (item?.id === undefined) return null;
  const el = document.querySelector<HTMLElement>(`.tsp-image[data-id="${CSS.escape(item.id)}"] .tsp-img-frame`);
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const visible =
    box.width > 0 &&
    box.height > 0 &&
    box.bottom > 0 &&
    box.right > 0 &&
    box.top < window.innerHeight &&
    box.left < window.innerWidth;
  return visible ? el : null;
}

function nameIt(el: HTMLElement | null): void {
  if (!el) return;
  el.style.setProperty("view-transition-name", groupName);
  el.setAttribute(namedAttr, "");
}

function clearNames(): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${namedAttr}]`)) {
    el.style.removeProperty("view-transition-name");
    el.removeAttribute(namedAttr);
  }
}

/**
 * 在一次 view transition 里做 `change`（同步提交到 DOM）。`before` 在旧状态截图前给旧一侧的元素起名，
 * `after` 在新状态里给新一侧的元素起名；两侧同名元素任何时候只能有一个。
 * 根元素上的 data 属性只在这一次动画期间存在，tsp.css 靠它把时长限定在这次 transition 上，不碰切主题的整窗淡入。
 */
function transition(change: () => void, before: HTMLElement | null, after: () => HTMLElement | null): void {
  const mine = ++generation;
  clearNames();
  nameIt(before);
  document.documentElement.setAttribute(markAttr, "");
  const run = document.startViewTransition(() => {
    clearNames();
    flushSync(change);
    nameIt(after());
  });
  void run.finished.finally(() => {
    if (mine !== generation) return;
    clearNames();
    document.documentElement.removeAttribute(markAttr);
  });
}

/** `reduced`（来自 useReducedMotion）为真时不起名：只有遮罩的淡入淡出，没有位移缩放。 */
export function openZoom(items: readonly ZoomItem[], index: number, reduced: boolean): void {
  if (items.length === 0) return;
  const next = { items, index: Math.min(Math.max(index, 0), items.length - 1) };
  const thumb = reduced ? null : thumbnailOf(items[next.index]);
  transition(
    () => zoom.set(next),
    thumb,
    () => (thumb ? document.querySelector<HTMLElement>(largeSelector) : null),
  );
}

/** 切图只换图，不做容器变形。 */
export function stepZoom(delta: number): void {
  const state = zoom.get();
  if (!state) return;
  zoom.set({ ...state, index: (state.index + delta + state.items.length) % state.items.length });
}

/** 缩回当前这张的缩略图；缩略图不在视口或已卸载时只淡出。 */
export function closeZoom(reduced: boolean): void {
  const state = zoom.get();
  if (!state) return;
  const thumb = reduced ? null : thumbnailOf(state.items[state.index]);
  transition(
    () => zoom.set(null),
    thumb ? document.querySelector<HTMLElement>(largeSelector) : null,
    () => thumb,
  );
}

export function useZoom(): ZoomState | null {
  return useStoreValue(zoom, (state) => state);
}
