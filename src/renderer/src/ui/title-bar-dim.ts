// 有遮罩（--bg-scrim）的弹窗开着时，让主进程把系统三键（titleBarOverlay，不是网页画的，遮罩盖不到）一起调暗。
// 每个带遮罩的弹窗在打开期间调用 useTitleBarDim(true)；按打开的个数计数，第一个打开时变暗、最后一个关闭时恢复。
// 浏览器面板的页面（主进程的视图，同样盖在网页上面）也按这个计数：有遮罩弹窗时藏起来（subscribeScrims）。
import { useEffect } from "react";

let openScrims = 0;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

export function useTitleBarDim(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (openScrims++ === 0) {
      void window.studio.setTitleBarDimmed(true);
      changed();
    }
    return () => {
      if (--openScrims === 0) {
        void window.studio.setTitleBarDimmed(false);
        changed();
      }
    };
  }, [active]);
}

export function scrimsOpen(): boolean {
  return openScrims > 0;
}

/** 有没有遮罩弹窗开着的变化。 */
export function subscribeScrims(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
