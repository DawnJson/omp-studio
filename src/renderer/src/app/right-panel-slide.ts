// 右栏开 / 关时主区和右栏像并排的两页一起动（spec §2.6「右栏开 / 关」，所有者定 2026-11-25）：
// 右栏滑进来多少，主区右边缘就收回多少；滑出去多少，主区就让出多少，中间一直隔着同一道缝，不留残影。
// 主区宽度不逐帧重排（长对话一次排版 60ms 以上）：动画期间右栏钉成绝对定位、脱离排版，主区按全宽排一次，
// 右边缘用 clip-path 跟着右栏的左边缘走；对话列、门、输入框这些居中的块用 transform 从一个位置滑到另一个位置。
// 文字只在动画开始时换一次行，不在结束时闪：打开时这些块一开始就锁成变窄后的宽度（右栏挂上那一帧量到的），
// 放完把右栏放回排版、撤掉锁定，宽度正好对上，不再重排；关闭时主区一开始就变宽，同样在开头换行。
// 关闭时右栏一直钉着，滑完卸载。
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** 跟着滑的块：居中的对话列、门所在的 dock、输入框（含状态行）、空状态。铺满主区的（终端、滚动区本身）不动。 */
const targets = ".tsp-column, .tsp-dock-in, .composer-stack, .empty-main";
const pinned = ["position", "left", "top", "width", "height", "margin"] as const;

interface Box {
  left: number;
  width: number;
}

function boxes(main: HTMLElement): Map<HTMLElement, Box> {
  const out = new Map<HTMLElement, Box>();
  for (const el of main.querySelectorAll<HTMLElement>(targets)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) out.set(el, { left: rect.left, width: rect.width });
  }
  return out;
}

/** 钉在原地（offset* 相对 .body，它是定位祖先；不算 transform，所以滑入中途也是排版里的位置）。 */
function pin(pane: HTMLElement): void {
  const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = pane;
  Object.assign(pane.style, {
    position: "absolute",
    left: `${offsetLeft}px`,
    top: `${offsetTop}px`,
    width: `${offsetWidth}px`,
    height: `${offsetHeight}px`,
    margin: "0",
  });
}

function unpin(pane: HTMLElement): void {
  for (const key of pinned) pane.style.removeProperty(key);
}

/** 右栏紧跟在 main 后面（App 里的 shownRightPanel）。 */
function paneOf(main: HTMLElement): HTMLElement | null {
  const next = main.nextElementSibling;
  return next instanceof HTMLElement ? next : null;
}

/**
 * 放一次开 / 关：右栏此刻在排版里（主区是窄的）。返回撤销函数（又开 / 关了就先撤掉这一次）。
 * 时长和曲线取右栏自己的 panel-in / panel-out（减少动效时为 0：打开直接放回排版，关闭照样钉着等卸载）。
 */
function play(main: HTMLElement, pane: HTMLElement, open: boolean): () => void {
  const style = getComputedStyle(pane);
  const duration = parseFloat(style.animationDuration) * (style.animationDuration.endsWith("ms") ? 1 : 1000);
  const narrowWidth = main.getBoundingClientRect().width;
  const narrow = boxes(main);
  pin(pane);
  if (!(duration > 0)) {
    if (open) unpin(pane);
    return () => {};
  }
  // 打开：主区此刻已按全宽排，块先锁回窄宽度（同一帧里，画出来之前），只平移不重排
  const locked = open ? [...narrow] : [];
  for (const [el, box] of locked) el.style.width = `${box.width}px`;
  const wide = new Map([...boxes(main)].map(([el, box]) => [el, box.left]));
  const gap = main.getBoundingClientRect().width - narrowWidth;
  const timing = { duration, easing: style.animationTimingFunction, fill: "both" } as const;
  const round = getComputedStyle(main).borderTopRightRadius;
  const clip = (right: number) => `inset(0 ${right}px 0 0 round ${round})`;
  const animations = [
    main.animate({ clipPath: open ? [clip(0), clip(gap)] : [clip(gap), clip(0)] }, timing),
    ...[...wide].flatMap(([el, left]) => {
      const shift = (narrow.get(el)?.left ?? left) - left;
      if (Math.abs(shift) < 1) return [];
      const at = (x: number) => ({ transform: `translateX(${x}px)` });
      return [el.animate(open ? [at(0), at(shift)] : [at(shift), at(0)], timing)];
    }),
  ];
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (open) unpin(pane);
    for (const [el] of locked) el.style.removeProperty("width");
    for (const animation of animations) animation.cancel();
  };
  animations[0]!.finished.then(settle, () => {});
  return settle;
}

export function useRightPanelSlide(open: boolean, main: RefObject<HTMLElement | null>): void {
  const last = useRef(open);
  /** 正在放的那一次的撤销函数。 */
  const running = useRef<(() => void) | null>(null);
  /** 打开时面板是懒加载的，提交那一刻还不在 DOM 里：等它挂上、主区变窄（ResizeObserver，画之前回调）再放。 */
  const pending = useRef(false);

  useLayoutEffect(() => {
    if (last.current === open) return;
    last.current = open;
    running.current?.();
    running.current = null;
    pending.current = false;
    const root = main.current;
    const pane = root === null ? null : paneOf(root);
    if (root === null) return;
    if (pane === null) {
      pending.current = open;
      return;
    }
    // 滑出没放完又打开：还是同一个元素，先放回排版
    if (open) unpin(pane);
    running.current = play(root, pane, open);
  }, [open, main]);

  useEffect(() => {
    const root = main.current;
    if (root === null) return;
    const observer = new ResizeObserver(() => {
      const pane = paneOf(root);
      if (!pending.current || pane === null) return;
      pending.current = false;
      running.current = play(root, pane, true);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      running.current?.();
    };
  }, [main]);
}
