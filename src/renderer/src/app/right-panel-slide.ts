// 右栏开 / 关（spec §2.6「右栏开 / 关」，所有者定 2026-11-26）：右栏在排版里，margin-right 从"整块藏在窗口右边外"
// 过渡到 0（motion.css 的 panel-in / panel-out），主区跟着逐帧变窄 / 变宽，两者之间一直是同一道缝。
// 藏多少要知道右栏自己的宽度（36% 或拖出来的 px，再受 min / max-width 夹），百分比 margin 算不出来：
// 右栏挂上和开始关闭时量一次，写进它的 --pane-w。
// 开合期间主区逐帧变宽变窄，对话列不逐帧通知 omp 改列数（omp 每次整篇重排、换掉节点，焦点和选中会丢）：动画放完量一次。
import { useEffect, useLayoutEffect, type RefObject } from "react";
import { holdColumns } from "../features/tsp/ColumnResizer.tsx";

/** 右栏紧跟在 main 后面（App 里的 shownRightPanel）。 */
function paneOf(main: HTMLElement): HTMLElement | null {
  const next = main.nextElementSibling;
  return next instanceof HTMLElement ? next : null;
}

function measure(main: HTMLElement): boolean {
  const pane = paneOf(main);
  if (pane === null) return false;
  pane.style.setProperty("--pane-w", `${pane.offsetWidth}px`);
  return true;
}

export function useRightPanelWidth(open: boolean, main: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const root = main.current;
    const body = root?.parentElement;
    if (root == null || body == null || measure(root)) return;
    // 面板是懒加载的：第一次打开时组件还没到，等它挂进来再量（到之前 panel-in 用 CSS 里的默认宽度）。
    const observer = new MutationObserver(() => {
      if (measure(root)) observer.disconnect();
    });
    observer.observe(body, { childList: true });
    return () => observer.disconnect();
  }, [open, main]);
}

/** 会让主区变宽变窄的动画：侧栏列的 margin-left、.body 的 padding-left、右栏的 panel-in / panel-out。 */
function moving(event: TransitionEvent | AnimationEvent): string | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return null;
  if (event instanceof AnimationEvent)
    return event.animationName === "panel-in" || event.animationName === "panel-out" ? "pane" : null;
  if (event.propertyName === "margin-left" && target.classList.contains("sidebar-column")) return "sidebar";
  if (event.propertyName === "padding-left" && target.classList.contains("body")) return "body";
  return null;
}

/** 动画中途元素被卸掉（换成另一个右栏面板）时不会有 end / cancel 事件：到点自己放开。比 --dur-pane 宽裕。 */
const holdFallbackMs = 1_000;

/** 侧栏、右栏开合动画放着的时候占住对话列宽，放完（或中途取消）放开。 */
export function usePaneColumnHold(main: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const body = main.current?.parentElement;
    if (body == null) return;
    const releases = new Map<string, () => void>();
    const release = (key: string) => {
      releases.get(key)?.();
      releases.delete(key);
    };
    const start = (event: TransitionEvent | AnimationEvent) => {
      const key = moving(event);
      if (key === null || releases.has(key)) return;
      const unhold = holdColumns();
      const timer = setTimeout(() => release(key), holdFallbackMs);
      releases.set(key, () => {
        clearTimeout(timer);
        unhold();
      });
    };
    const end = (event: TransitionEvent | AnimationEvent) => {
      const key = moving(event);
      if (key !== null) release(key);
    };
    body.addEventListener("transitionrun", start);
    body.addEventListener("transitionend", end);
    body.addEventListener("transitioncancel", end);
    body.addEventListener("animationstart", start);
    body.addEventListener("animationend", end);
    body.addEventListener("animationcancel", end);
    return () => {
      body.removeEventListener("transitionrun", start);
      body.removeEventListener("transitionend", end);
      body.removeEventListener("transitioncancel", end);
      body.removeEventListener("animationstart", start);
      body.removeEventListener("animationend", end);
      body.removeEventListener("animationcancel", end);
      for (const key of releases.keys()) release(key);
    };
  }, [main]);
}
