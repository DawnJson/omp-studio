// 有遮罩（--bg-scrim）的弹窗开着时，让主进程把系统三键（titleBarOverlay，不是网页画的，遮罩盖不到）一起调暗。
// 每个带遮罩的弹窗在打开期间调用 useTitleBarDim(true)；按打开的个数计数，第一个打开时变暗、最后一个关闭时恢复。
import { useEffect } from "react";

let openScrims = 0;

export function useTitleBarDim(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (openScrims++ === 0) void window.studio.setTitleBarDimmed(true);
    return () => {
      if (--openScrims === 0) void window.studio.setTitleBarDimmed(false);
    };
  }, [active]);
}
